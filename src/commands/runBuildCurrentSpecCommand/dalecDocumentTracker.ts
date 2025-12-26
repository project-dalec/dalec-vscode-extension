import * as vscode from 'vscode';
import YAML, { LineCounter, Pair, visit } from 'yaml';

// Legacy regex for built-in Dalec frontend patterns
const LEGACY_SYNTAX_REGEX = /^#\s*syntax\s*=\s*(?<image>ghcr\.io\/(?:project-dalec|azure)\/dalec\/frontend:[^\s#]+|[^\s#]*dalec[^\s#]*)/i;

// Regex to extract the image from a syntax directive for custom directive matching
const SYNTAX_DIRECTIVE_REGEX = /^#\s*syntax\s*=\s*(?<image>[^\s#]+)/i;

const contextSelectionCache = new Map<string, ContextSelection>();
const argsSelectionCache = new Map<string, ArgsSelection>();
const YAML_EXTENSION_ID = 'redhat.vscode-yaml';
const SCHEMA_SCHEME = 'dalec-schema';
const FALLBACK_SCHEMA_RELATIVE_PATH = ['schemas', 'spec.schema.json'];
type YamlExtensionApi = YamlExtensionExports;
// dalec-vscode-tools

interface ArgsSelection {
  values: Map<string, string>;
}

interface DalecDocumentMetadata {
  targets: string[];
  contexts: string[];
  args: Map<string, string | undefined>;
}

interface ContextSelection {
  defaultContextPath: string;
  additionalContexts: Map<string, string>;
}

type DalecSpecDocument = Record<string, unknown>;

/**
 * Validates a directive pattern and returns an error message if invalid.
 * Valid patterns: exact strings or strings ending with a single '*' (suffix wildcard).
 */
function validateDirectivePattern(pattern: string): string | undefined {
  if (!pattern || pattern.trim().length === 0) {
    return 'Empty pattern is not allowed';
  }

  const wildcardCount = (pattern.match(/\*/g) || []).length;

  if (wildcardCount === 0) {
    // Exact match pattern - valid
    return undefined;
  }

  if (wildcardCount > 1) {
    return `Multiple wildcards not supported: "${pattern}"`;
  }

  if (!pattern.endsWith('*')) {
    return `Wildcard must be at the end of the pattern: "${pattern}"`;
  }

  // Single suffix wildcard - valid
  return undefined;
}

/**
 * Returns the configured syntax directives from VS Code settings.
 * Validates patterns and warns about invalid ones.
 */
function getConfiguredSyntaxDirectives(): string[] {
  const config = vscode.workspace.getConfiguration('dalec-spec');
  const directives = config.get<string[]>('syntaxDirectives', ['ghcr.io/project-dalec/dalec/frontend:latest']);
  
  // Validate and filter patterns, warning about invalid ones
  const validDirectives: string[] = [];
  const invalidPatterns: string[] = [];

  for (const pattern of directives) {
    const error = validateDirectivePattern(pattern);
    if (error) {
      invalidPatterns.push(error);
    } else {
      validDirectives.push(pattern);
    }
  }

  // Show warning once per invalid configuration (debounced via static flag)
  if (invalidPatterns.length > 0 && !getConfiguredSyntaxDirectives.hasWarnedInvalidPatterns) {
    getConfiguredSyntaxDirectives.hasWarnedInvalidPatterns = true;
    void vscode.window.showWarningMessage(
      `Dalec: Invalid syntax directive patterns will be ignored:\n${invalidPatterns.join('\n')}`,
      'Open Settings'
    ).then((selection) => {
      if (selection === 'Open Settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'dalec-spec.syntaxDirectives');
      }
    });
    // Reset flag after a delay to allow re-warning if user changes config again
    setTimeout(() => {
      getConfiguredSyntaxDirectives.hasWarnedInvalidPatterns = false;
    }, 5000);
  }

  return validDirectives;
}
// Static property for warning debounce
getConfiguredSyntaxDirectives.hasWarnedInvalidPatterns = false;

/**
 * Returns whether legacy/built-in directives should be accepted.
 */
function getAllowLegacyDirectives(): boolean {
  const config = vscode.workspace.getConfiguration('dalec-spec');
  return config.get<boolean>('allowLegacyDirectives', true);
}

/**
 * Checks if a syntax directive image matches a pattern.
 * Supports wildcard suffix with '*' (e.g., 'ghcr.io/org/image:*' matches 'ghcr.io/org/image:v1.0').
 * Assumes pattern has been validated (single suffix wildcard or exact match).
 */
function matchesDirective(image: string, pattern: string): boolean {
  const normalizedImage = image.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedImage.startsWith(prefix);
  }

  return normalizedImage === normalizedPattern;
}

/**
 * Validates if the first line of a document contains a valid Dalec syntax directive.
 * Checks configured directives first, then falls back to legacy patterns if enabled.
 */
export function isValidSyntaxDirective(firstLine: string): boolean {
  // Extract the image from the directive
  const match = SYNTAX_DIRECTIVE_REGEX.exec(firstLine);
  if (!match?.groups?.image) {
    return false;
  }

  const image = match.groups.image;
  const configuredDirectives = getConfiguredSyntaxDirectives();

  // Check configured directives first (user's explicit configuration takes priority)
  if (configuredDirectives.some((pattern) => matchesDirective(image, pattern))) {
    return true;
  }

  // Fall back to legacy patterns if enabled
  const allowLegacy = getAllowLegacyDirectives();
  if (allowLegacy && LEGACY_SYNTAX_REGEX.test(firstLine)) {
    return true;
  }

  return false;
}

export class DalecDocumentTracker implements vscode.Disposable {
  private readonly tracked = new Map<string, DalecDocumentMetadata>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.evaluate(doc)),
      vscode.workspace.onDidChangeTextDocument((event) => this.evaluate(event.document)),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        if (this.tracked.delete(key)) {
          this.changeEmitter.fire(doc.uri);
        }
      }),
      // Re-evaluate all documents when configuration changes
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dalec-spec.syntaxDirectives') ||
            event.affectsConfiguration('dalec-spec.allowLegacyDirectives')) {
          this.reevaluateAllDocuments();
        }
      }),
    );

    vscode.workspace.textDocuments.forEach((doc) => this.evaluate(doc));
  }

  dispose() {
    this.tracked.clear();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.changeEmitter.dispose();
  }

  isDalecDocument(document: vscode.TextDocument): boolean {
    return this.tracked.has(document.uri.toString());
  }

  has(resource: string): boolean {
    return this.tracked.has(resource);
  }

  getMetadata(resource: vscode.TextDocument | string): DalecDocumentMetadata | undefined {
    const key = typeof resource === 'string' ? resource : resource.uri.toString();
    return this.tracked.get(key);
  }

  private reevaluateAllDocuments() {
    // Warn if configuration would reject all documents
    const configuredDirectives = getConfiguredSyntaxDirectives();
    const allowLegacy = getAllowLegacyDirectives();
    if (configuredDirectives.length === 0 && !allowLegacy) {
      void vscode.window.showWarningMessage(
        'Dalec: No syntax directives configured and legacy directives disabled. ' +
        'All Dalec specs will be rejected. Add directives to "dalec-spec.syntaxDirectives" ' +
        'or enable "dalec-spec.allowLegacyDirectives".'
      );
    }

    // Re-evaluate all open text documents when settings change
    vscode.workspace.textDocuments.forEach((doc) => this.evaluate(doc));
  }

  private evaluate(document: vscode.TextDocument) {
    if (!this.isYamlFile(document)) {
      this.delete(document.uri);
      return;
    }

    const firstLine = document.lineCount > 0 ? document.lineAt(0).text.trim() : '';
    if (!firstLine || !isValidSyntaxDirective(firstLine)) {
      this.delete(document.uri);
      return;
    }

    const metadata: DalecDocumentMetadata = this.buildMetadata(document);

    const key = document.uri.toString();
    clearCachedContextSelection(document.uri);
    clearCachedArgsSelection(document.uri);
    this.tracked.set(key, metadata);
    this.changeEmitter.fire(document.uri);
  }

  private delete(uri: vscode.Uri) {
    const key = uri.toString();
    if (this.tracked.delete(key)) {
      this.changeEmitter.fire(uri);
    }
    clearCachedContextSelection(uri);
    clearCachedArgsSelection(uri);
  }

  private buildMetadata(document: vscode.TextDocument): DalecDocumentMetadata {
    const parsed = parseDalecSpec(document.getText());
    if (!parsed) {
      return {
        targets: [],
        contexts: [],
        args: new Map<string, string | undefined>(),
      };
    }

    return {
      targets: extractTargetsFromSpec(parsed),
      contexts: extractContextNamesFromSpec(parsed),
      args: extractArgsFromSpec(parsed),
    };
  }

  private isYamlFile(document: vscode.TextDocument): boolean {
    const fileName = document.uri.fsPath.toLowerCase();
    return (
      (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) &&
      (document.languageId === 'yaml' || document.languageId === 'yml')
    );
  }
}


function clearCachedContextSelection(uri: vscode.Uri) {
  contextSelectionCache.delete(uri.toString());
}

function clearCachedArgsSelection(uri: vscode.Uri) {
  argsSelectionCache.delete(uri.toString());
}

function toInputValue(value: string | undefined): string {
  return value ?? '.';
}


function extractTargetsFromSpec(spec: DalecSpecDocument): string[] {
  const rawTargets = spec.targets;
  if (!isRecordLike(rawTargets)) {
    return [];
  }
  return Object.keys(rawTargets);
}

function extractContextNamesFromSpec(spec: DalecSpecDocument): string[] {
  const contexts = new Set<string>();
  collectContextNames(spec, contexts);
  return [...contexts];
}

function collectContextNames(value: unknown, results: Set<string>) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectContextNames(entry, results);
    }
    return;
  }
  if (!isRecordLike(value)) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'context')) {
    const name = getContextName(value.context);
    if (name) {
      results.add(name);
    }
  }

  for (const child of Object.values(value)) {
    collectContextNames(child, results);
  }
}

function getContextName(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return 'context';
  }
  if (typeof value === 'string') {
    return sanitizeContextName(value);
  }
  if (isRecordLike(value)) {
    const rawName = value.name;
    if (typeof rawName === 'string') {
      return sanitizeContextName(rawName);
    }
    return 'context';
  }
  return undefined;
}


function extractArgsFromSpec(spec: DalecSpecDocument): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  const rawArgs = spec.args;
  if (!isRecordLike(rawArgs)) {
    return result;
  }

  for (const [key, value] of Object.entries(rawArgs)) {
    if (value === null || value === undefined) {
      result.set(key, undefined);
      continue;
    }
    if (typeof value === 'string') {
      result.set(key, value);
      continue;
    }
    result.set(key, String(value));
  }
  return result;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDalecSpec(text: string): DalecSpecDocument | undefined {
  if (!text.trim()) {
    return undefined;
  }

  try {
    const parsed = YAML.parse(text);
    if (isRecordLike(parsed)) {
      return parsed;
    }
  } catch {
    // Ignore parse errors; fall back to empty metadata.
  }
  return undefined;
}

function sanitizeContextName(raw: string | undefined): string {
  if (!raw) {
    return 'context';
  }

  let cleaned = raw.trim();
  const commentIndex = cleaned.indexOf('#');
  if (commentIndex !== -1) {
    cleaned = cleaned.slice(0, commentIndex).trim();
  }
  cleaned = cleaned.replace(/[,}]+$/, '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned || 'context';
}

export class DalecSchemaProvider implements vscode.Disposable {
  private readonly fallbackSchemaUri: vscode.Uri;
  private yamlApi: YamlExtensionApi | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tracker: DalecDocumentTracker,
  ) {
    this.fallbackSchemaUri = vscode.Uri.joinPath(
      context.extensionUri,
      ...FALLBACK_SCHEMA_RELATIVE_PATH,
    );
  }

  async initialize() {
    const yamlExtension = vscode.extensions.getExtension<YamlExtensionExports>(YAML_EXTENSION_ID);
    if (!yamlExtension) {
      void vscode.window.showWarningMessage(
        'Dalec spec schema support requires the Red Hat YAML extension (redhat.vscode-yaml).',
      );
      return;
    }

    this.yamlApi = await yamlExtension.activate();

    if (!this.yamlApi?.registerContributor) {
      void vscode.window.showWarningMessage(
        'Installed YAML extension does not expose schema APIs; Dalec schema validation is disabled.',
      );
      return;
    }

    const registered = this.yamlApi.registerContributor(
      SCHEMA_SCHEME,
      (resource) => this.onRequestSchema(resource),
      (uri) => this.onRequestSchemaContent(uri),
    );

    if (!registered) {
      void vscode.window.showWarningMessage(
        'Dalec spec schema contributor could not be registered; another schema provider may already exist.',
      );
    } else {
      console.log('[Dalec] Schema contributor registered successfully');
    }
  }

  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private onRequestSchema(resource: string): string | undefined {
    if (!this.tracker.has(resource)) {
      return undefined;
    }

    const documentUri = vscode.Uri.parse(resource);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    const authority = workspaceFolder
      ? encodeURIComponent(workspaceFolder.uri.toString())
      : 'global';

    return `${SCHEMA_SCHEME}://${authority}/dalec-jsonschema`;
  }

  private async onRequestSchemaContent(uri: string): Promise<string | undefined> {
    const parsed = vscode.Uri.parse(uri);
    const authority = parsed.authority && parsed.authority !== 'global' ? parsed.authority : '';
    const workspaceUri = authority ? vscode.Uri.parse(decodeURIComponent(authority)) : undefined;

    const schemaContent = await this.readSchema(workspaceUri);
    return schemaContent;
  }

  private async readSchema(workspaceUri?: vscode.Uri): Promise<string | undefined> {
    if (workspaceUri) {
      const docPath = vscode.Uri.joinPath(workspaceUri, ...FALLBACK_SCHEMA_RELATIVE_PATH);
      try {
        const content = await vscode.workspace.fs.readFile(docPath);
        return new TextDecoder().decode(content);
      } catch (err) {
        // Fall back below.
        console.warn(`[Dalec] Could not load workspace schema: ${docPath.fsPath} (${err})`);
      }
    }

    try {
      const content = await vscode.workspace.fs.readFile(this.fallbackSchemaUri);
      return new TextDecoder().decode(content);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to load Dalec spec schema (${this.fallbackSchemaUri.fsPath}): ${error}`,
      );
      return undefined;
    }
  }
}

type YamlExtensionExports = {
  registerContributor?: (
    schema: string,
    requestSchema: (resource: string) => string | undefined,
    requestSchemaContent?: (uri: string) => Promise<string | undefined>,
  ) => boolean;
};