import * as vscode from 'vscode';
import { DalecDocumentTracker } from "../runBuildCurrentSpecCommand/dalecDocumentTracker";
import { LastDalecActionState } from "../runBuildCurrentSpecCommand/runBuildCommand";
import { resolveDalecDocument } from '../runBuildCurrentSpecCommand/helpers/documentHelpers';
import { BuildTargetInfo } from '../runBuildCurrentSpecCommand/helpers/targetHelpers';
import { getWorkspaceRootForUri } from '../runBuildCurrentSpecCommand/utils/pathHelpers';
import { ArgsSelection, collectArgsSelection, collectContextSelection, ContextSelection } from '../runBuildCurrentSpecCommand/helpers/contextHelpers';
import { createDockerBuildxCommand, logDockerCommand } from '../runBuildCurrentSpecCommand/utils/dockerHelpers';
import { recordFromMap } from '../runBuildCurrentSpecCommand/utils/conversionHelpers';
import { getBuildTerminalName, getOrCreateTerminal, getTerminalCommentPrefix } from '../runBuildCurrentSpecCommand/utils/terminalHelpers';

export async function rerunLastAction(
  tracker: DalecDocumentTracker,
  lastAction: LastDalecActionState,
  overrideType?: 'build' | 'debug',
) {
  const entry = lastAction.get();
  if (!entry) {
    void vscode.window.showInformationMessage('Dalec: no previous action to rerun.');
    return;
  }

  const document = await resolveDalecDocument(entry.specUri, tracker);
  if (!document) {
    return;
  }

  const metadata = tracker.getMetadata(document);
  const entryContexts = entry.contexts;
  const specContextNames = metadata?.contexts ?? [];
  const contextSelection =
    contextsSatisfied(entryContexts, specContextNames)
      ? entryContexts
      : await collectContextSelection(document, tracker, entryContexts);
  if (!contextSelection) {
    return;
  }

  const entryArgs = entry.args;
  const argsSelection = argsSatisfied(entryArgs, metadata?.args)
    ? entryArgs
    : await collectArgsSelection(document, tracker, entryArgs);
  if (!argsSelection) {
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(entry.specUri);

  const actionType = overrideType ?? entry.type;

  if (actionType === 'build') {
    const dockerCommand = createDockerBuildxCommand({
      mode: 'build',
      target: entry.target,
      specFile: entry.specUri.fsPath,
      context: contextSelection.defaultContextPath,
      buildArgs: argsSelection.values,
      buildContexts: contextSelection.additionalContexts,
    });
    const formattedCommand = logDockerCommand('Build command', dockerCommand);
    const terminalName = getBuildTerminalName(entry.target, entry.specUri);
    const terminal = getOrCreateTerminal(terminalName, {
      cwd: getWorkspaceRootForUri(entry.specUri),
      env: {
        ...process.env,
        BUILDX_EXPERIMENTAL: '1',
      },
    });
    terminal.show();
    terminal.sendText(`${getTerminalCommentPrefix()} Dalec command: ${formattedCommand}`);
    terminal.sendText(formattedCommand);
  } else if (actionType === 'debug') {
    const debugConfig: vscode.DebugConfiguration = {
      type: 'dalec-buildx',
      name: `Dalec Debug (${entry.target})`,
      request: 'launch',
      target: entry.target,
      specFile: entry.specUri.fsPath,
      context: contextSelection.defaultContextPath,
      buildContexts: recordFromMap(contextSelection.additionalContexts),
      buildArgs: recordFromMap(argsSelection.values),
      dalecContextResolved: true,
    };

    await vscode.debug.startDebugging(folder, debugConfig);
  }
}

function contextsSatisfied(selection: ContextSelection, requiredNames: string[]): boolean {
  const available = new Set(selection.additionalContexts.keys());
  available.add('context');
  for (const name of requiredNames) {
    if (!available.has(name)) {
      return false;
    }
  }
  return true;
}

function argsSatisfied(selection: ArgsSelection, definedArgs?: Map<string, string | undefined>): boolean {
  if (!definedArgs || definedArgs.size === 0) {
    return selection.values.size === 0;
  }
  if (selection.values.size === 0) {
    return false;
  }
  for (const key of definedArgs.keys()) {
    if (!selection.values.has(key)) {
      return false;
    }
  }
  return true;
}

function groupTargets(targets: BuildTargetInfo[]): Map<string, BuildTargetInfo[]> {
  const grouped = new Map<string, BuildTargetInfo[]>();
  for (const info of targets) {
    const scope = info.name.split('/')[0] || info.name;
    if (!grouped.has(scope)) {
      grouped.set(scope, []);
    }
    grouped.get(scope)!.push(info);
  }
  return grouped;
}

function isDebugScope(value: string): boolean {
  return value.toLowerCase() === 'debug';
}
