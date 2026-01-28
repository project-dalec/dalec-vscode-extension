import * as vscode from 'vscode';
import * as path from 'path';
import { DalecDocumentTracker } from './dalecDocumentTracker';
import { createDockerBuildxCommand, logDockerCommand, resolveDalecImageMetadata } from './utils/dockerHelpers';
import { getWorkspaceRootForUri, getWorkspaceRootForPath } from './utils/pathHelpers';
import { collectContextSelection, collectArgsSelection, type ContextSelection, type ArgsSelection } from './helpers/contextHelpers';
import { pickTarget } from './helpers/targetHelpers';
import { resolveDalecDocument, isValidDalecDoc } from './helpers/documentHelpers';
import { rewriteOutboundMessage, rewriteInboundMessage, logDapTraffic } from './helpers/dapHelpers';
import { recordFromMap, mapFromRecord } from './utils/conversionHelpers';
import { getBuildTerminalName, getOrCreateTerminal } from './utils/terminalHelpers';
import { getEmptyContextDir } from './helpers/contextHelpers';

const BUILD_COMMAND = 'dalec-vscode-tools.buildCurrentSpec';
const DEBUG_COMMAND = 'dalec-vscode-tools.debugCurrentSpec';

interface LastDalecAction {
  type: 'build' | 'debug';
  target: string;
  specUri: vscode.Uri;
  contexts: ContextSelection;
  args: ArgsSelection;
}

export class LastDalecActionState {
  private entry: LastDalecAction | undefined;

  record(entry: LastDalecAction) {
    this.entry = entry;
  }

  get(): LastDalecAction | undefined {
    return this.entry;
  }
}

export async function runBuildCommand(
  uri: vscode.Uri | undefined,
  tracker: DalecDocumentTracker,
  lastAction: LastDalecActionState,
) {
  await isValidDalecDoc(tracker);
  const document = await resolveDalecDocument(uri, tracker);
  if (!document) {
    return;
  }
  if (document.isDirty) {
    await document.save();
  }

  const target = await pickTarget(document, tracker, 'Select a Dalec target to build');
  if (!target) {
    return;
  }

  const contextSelection = await collectContextSelection(document, tracker);
  if (!contextSelection) {
    return;
  }

  const argsSelection = await collectArgsSelection(document, tracker);
  if (!argsSelection) {
    return;
  }

  void vscode.window.showInformationMessage(`Starting Dalec build for "${target}"...`);

  const resolvedMetadata = await resolveDalecImageMetadata(document.uri.fsPath, {
    target,
    buildArgs: argsSelection.values,
    buildContexts: contextSelection.additionalContexts,
  });

  let imageTag: string | undefined;
  if (resolvedMetadata.version && resolvedMetadata.revision) {
    imageTag = `${resolvedMetadata.version}-${resolvedMetadata.revision}`;
  } else if (resolvedMetadata.version) {
    imageTag = resolvedMetadata.version;
  }

  const dockerCommand = createDockerBuildxCommand({
    mode: 'build',
    target,
    specFile: document.uri.fsPath,
    context: contextSelection.defaultContextPath,
    buildArgs: argsSelection.values,
    buildContexts: contextSelection.additionalContexts,
    imageName: resolvedMetadata.name,
    imageTag,
  });

  const formattedCommand = logDockerCommand('Build command', dockerCommand);
  const terminalName = getBuildTerminalName(target, document.uri);
  const terminal = getOrCreateTerminal(terminalName, {
    cwd: getWorkspaceRootForUri(document.uri),
    env: {
      ...process.env,
      BUILDX_EXPERIMENTAL: '1',
    },
  });

  terminal.show();
  terminal.sendText(formattedCommand);

  lastAction.record({
    type: 'build',
    target,
    specUri: document.uri,
    contexts: contextSelection,
    args: argsSelection,
  });
}

export async function runDebugCommand(
  uri: vscode.Uri | undefined,
  tracker: DalecDocumentTracker,
  lastAction: LastDalecActionState,
) {
  await isValidDalecDoc(tracker);
  const document = await resolveDalecDocument(uri, tracker);
  if (!document) {
    return;
  }
  if (document.isDirty) {
    await document.save();
  }

  const target = await pickTarget(document, tracker, 'Select a Dalec target to debug');
  if (!target) {
    return;
  }

  const contextSelection = await collectContextSelection(document, tracker);
  if (!contextSelection) {
    return;
  }

  const argsSelection = await collectArgsSelection(document, tracker);
  if (!argsSelection) {
    return;
  }

  void vscode.window.showInformationMessage(`Starting Dalec debug for "${target}"...`);

  const debugConfig: vscode.DebugConfiguration = {
    type: 'dalec-buildx',
    name: `Dalec Debug (${target})`,
    request: 'launch',
    target,
    specFile: document.uri.fsPath,
    context: contextSelection.defaultContextPath,
    buildContexts: recordFromMap(contextSelection.additionalContexts),
    buildArgs: recordFromMap(argsSelection.values),
    dalecContextResolved: true,
  };

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  await vscode.debug.startDebugging(folder, debugConfig);

  lastAction.record({
    type: 'debug',
    target,
    specUri: document.uri,
    contexts: contextSelection,
    args: argsSelection,
  });
}

export class DalecCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly trackerSubscription: vscode.Disposable;

  constructor(private readonly tracker: DalecDocumentTracker, private readonly lastAction: LastDalecActionState) {
    this.trackerSubscription = this.tracker.onDidChange(() => this.emitter.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] | undefined {
    if (!this.tracker.isDalecDocument(document)) {
      return undefined;
    }

    // Give each lens a unique range so VS Code orders them deterministically.
    const rangeFor = (order: number) => new vscode.Range(0, order, 0, order);
    const lenses: vscode.CodeLens[] = [];
    const addLens = (command: string, title: string, args?: unknown[]) => {
      lenses.push(
        new vscode.CodeLens(rangeFor(lenses.length), {
          command,
          title,
          ...(args ? { arguments: args } : {}),
        }),
      );
    };

    addLens(BUILD_COMMAND, 'Dalec: Build', [document.uri]);
    addLens(DEBUG_COMMAND, 'Dalec: Debug', [document.uri]);

    const last = this.lastAction.get();
    if (last && last.specUri.toString() === document.uri.toString()) {
      addLens('dalec-vscode-tools.rerunLastActionBuild', `Dalec: Build (${last.target})`);
      addLens('dalec-vscode-tools.rerunLastActionDebug', `Dalec: Debug (${last.target})`);
    }

    return lenses;
  }

  dispose() {
    this.trackerSubscription.dispose();
    this.emitter.dispose();
  }
}

export class DalecDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(private readonly tracker: DalecDocumentTracker) {}

  async resolveDebugConfigurationWithSubstitutedVariables(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): Promise<vscode.DebugConfiguration | null | undefined> {
    if (!config.target || typeof config.target !== 'string') {
      void vscode.window.showErrorMessage('A Dalec target name is required (debug configuration "target").');
      return null;
    }

    const specFile = typeof config.specFile === 'string' ? config.specFile.trim() : '';
    if (!specFile) {
      void vscode.window.showErrorMessage('Dalec spec file could not be resolved.');
      return null;
    }

    const resolvedSpec = this.resolvePath(specFile, folder);
    // const resolvedSpec = specFile;
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(resolvedSpec));
    } catch {
      void vscode.window.showErrorMessage(`Dalec spec file not found: ${resolvedSpec}`);
      return null;
    }

    config.specFile = resolvedSpec;

    if (typeof config.cwd === 'string' && config.cwd.trim()) {
      config.cwd = this.resolvePath(config.cwd, folder);
    }

    if (config.buildArgs && typeof config.buildArgs !== 'object') {
      void vscode.window.showWarningMessage('Ignoring buildArgs – value must be an object map.');
      delete config.buildArgs;
    }

    const document = await vscode.workspace.openTextDocument(resolvedSpec);
    if (!this.tracker.isDalecDocument(document)) {
      void vscode.window.showErrorMessage('Selected file is not recognized as a Dalec spec.');
      return null;
    }

    if (!config.dalecContextResolved) {
      const selection = await collectContextSelection(document, this.tracker);
      if (!selection) {
        return undefined;
      }
      config.context = selection.defaultContextPath;
      config.buildContexts = recordFromMap(selection.additionalContexts);
      config.dalecContextResolved = true;
    }

    if (!config.context) {
      config.context = await getEmptyContextDir();
    }

    const workspaceForSpec = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(resolvedSpec)) ?? folder;
    config.context = this.resolvePath(config.context, workspaceForSpec);

    if (config.buildContexts && typeof config.buildContexts === 'object') {
      const resolved: Record<string, string> = {};
      const entries = Object.entries(config.buildContexts as Record<string, string>);
      for (const [name, ctxPath] of entries) {
        resolved[name] = this.resolvePath(ctxPath, workspaceForSpec);
      }
      config.buildContexts = resolved;
    }

    // Resolve name and tag for the debug image so it is not anonymous
    try {
      const metadata = await resolveDalecImageMetadata(config.specFile, {
        target: config.target,
        buildArgs: mapFromRecord(config.buildArgs),
        buildContexts: mapFromRecord(config.buildContexts as Record<string, string> | undefined),
      });

      if (metadata.name) {
        config.imageName = metadata.name;
        if (metadata.version && metadata.revision) {
          config.imageTag = `${metadata.version}-${metadata.revision}`;
        } else if (metadata.version) {
          config.imageTag = metadata.version;
        }
      }
    } catch (e) {
      console.warn('Failed to resolve image metadata for debug session:', e);
    }

    return config;
  }

  private resolvePath(input: string, folder: vscode.WorkspaceFolder | undefined): string {
    if (path.isAbsolute(input)) {
      return input;
    }

    if (folder) {
      return path.join(folder.uri.fsPath, input);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      return path.join(workspaceFolder.uri.fsPath, input);
    }

    return path.resolve(input);
  }
}

export class DalecDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(
    session: vscode.DebugSession,
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    const config = session.configuration as DalecDebugConfiguration;
    const cwd = config.cwd ?? config.workspaceFolder ?? getWorkspaceRootForPath(config.specFile) ?? process.cwd();
    // Use absolute path for the spec file when running DAP, to align with VS Code's breakpoints
    
    const dockerCommand = createDockerBuildxCommand({
      mode: 'dap',
      target: config.target,
      specFile: config.specFile,
      context: config.context,
      buildArgs: mapFromRecord(config.buildArgs),
      buildContexts: mapFromRecord(config.buildContexts),
      imageName: config.imageName,
      imageTag: config.imageTag,
    });
    logDockerCommand('Debug command', dockerCommand, { toDebugConsole: true });

    const options: vscode.DebugAdapterExecutableOptions = {
      cwd,
      env: {
        ...process.env,
        BUILDX_EXPERIMENTAL: '1',
      },
    };

    return new vscode.DebugAdapterExecutable(dockerCommand.binary, dockerCommand.args, options);
  }
}

export class DalecDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
  createDebugAdapterTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
    const config = session.configuration as DalecDebugConfiguration;
    const cwd = config.cwd ?? config.workspaceFolder ?? getWorkspaceRootForPath(config.specFile) ?? process.cwd();
    const absoluteSpecFile = config.specFile;
    const relativeSpecFile = path.relative(cwd, absoluteSpecFile);

    return {
      onWillReceiveMessage: (message) => {
        rewriteOutboundMessage(message, absoluteSpecFile, relativeSpecFile);
        logDapTraffic('client->server', message);
      },
      onDidSendMessage: (message) => {
        rewriteInboundMessage(message, absoluteSpecFile, relativeSpecFile);
        logDapTraffic('server->client', message);
      },
      onError: (error) => logDapTraffic('error', error),
      onExit: (code, signal) => logDapTraffic('exit', { code, signal }),
    };
  }
}

interface DalecDebugConfiguration extends vscode.DebugConfiguration {
  target: string;
  specFile: string;
  context: string;
  buildArgs?: Record<string, string>;
  buildContexts?: Record<string, string>;
  dalecContextResolved?: boolean;
  imageName?: string;
  imageTag?: string;
}
