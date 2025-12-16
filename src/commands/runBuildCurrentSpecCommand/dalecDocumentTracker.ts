import * as vscode from 'vscode';
import YAML, { LineCounter, Pair, visit } from 'yaml';

const SYNTAX_REGEX = /^#\s*(?:syntax|sytnax)\s*=\s*(?<image>ghcr\.io\/(?:project-dalec|azure)\/dalec\/frontend:[^\s#]+|[^\s#]*dalec[^\s#]*)/i;
const contextSelectionCache = new Map<string, ContextSelection>();
const argsSelectionCache = new Map<string, ArgsSelection>();
const YAML_EXTENSION_ID = 'redhat.vscode-yaml';
const SCHEMA_SCHEME = 'dalec-schema';
const FALLBACK_SCHEMA_RELATIVE_PATH = ['docs', 'spec.schema.json'];
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

  private evaluate(document: vscode.TextDocument) {
    if (!this.isYamlFile(document)) {
      this.delete(document.uri);
      return;
    }

    const firstLine = document.lineCount > 0 ? document.lineAt(0).text.trim() : '';
    if (!firstLine || !SYNTAX_REGEX.test(firstLine)) {
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
      const docPath = vscode.Uri.joinPath(workspaceUri, 'docs', 'spec.schema.json');
      try {
        const content = await vscode.workspace.fs.readFile(docPath);
        return new TextDecoder().decode(content);
      } catch {
        // Fall back below.
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