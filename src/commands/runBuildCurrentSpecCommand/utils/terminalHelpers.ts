import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceRootForUri } from './pathHelpers';

const terminalRegistry = new Map<string, vscode.Terminal>();
let terminalCloseSubscription: vscode.Disposable | undefined;
let terminalCloseDisposed = false;

export function getTerminalCommentPrefix(): string {
  const shell = vscode.env.shell?.toLowerCase() ?? '';
  if (shell.includes('cmd.exe')) {
    return 'REM';
  }
  return '#';
}

type TerminalOptionsWithoutName = Omit<vscode.TerminalOptions, 'name'>;

export function getOrCreateTerminal(name: string, options: TerminalOptionsWithoutName): vscode.Terminal {
  ensureTerminalCleanup();

  const cached = terminalRegistry.get(name);
  if (cached && isTerminalReusable(cached)) {
    return cached;
  }
  if (cached) {
    terminalRegistry.delete(name);
  }

  const existing = findTerminalByName(name);
  if (existing && isTerminalReusable(existing)) {
    terminalRegistry.set(name, existing);
    return existing;
  }

  const created = vscode.window.createTerminal({
    ...options,
    name,
  });
  terminalRegistry.set(name, created);
  return created;
}

export function getBuildTerminalName(target: string, specUri: vscode.Uri): string {
  const workspaceRoot = getWorkspaceRootForUri(specUri);
  const relativePath = workspaceRoot ? path.relative(workspaceRoot, specUri.fsPath) : '';
  const hasParentTraversal = relativePath.startsWith('..') || relativePath.startsWith(`..${path.sep}`);
  const specLabel =
    relativePath && relativePath !== '.' && !hasParentTraversal
      ? relativePath
      : path.basename(specUri.fsPath);
  return `Dalec Build (${target}) - ${specLabel}`;
}

export function registerTerminalCleanup(): vscode.Disposable {
  if (!terminalCloseSubscription || terminalCloseDisposed) {
    terminalCloseDisposed = false;
    terminalCloseSubscription = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [name, tracked] of terminalRegistry.entries()) {
        if (tracked === terminal) {
          terminalRegistry.delete(name);
          break;
        }
      }
    });
  }

  return new vscode.Disposable(() => {
    if (terminalCloseSubscription) {
      terminalCloseSubscription.dispose();
      terminalCloseSubscription = undefined;
      terminalCloseDisposed = true;
    }
  });
}

function ensureTerminalCleanup(): void {
  void registerTerminalCleanup();
}

function findTerminalByName(name: string): vscode.Terminal | undefined {
  const suffixPrefix = `${name} (`;
  return vscode.window.terminals.find((terminal) =>
    terminal.name === name || terminal.name.startsWith(suffixPrefix),
  );
}

function isTerminalReusable(terminal: vscode.Terminal): boolean {
  return vscode.window.terminals.includes(terminal) && terminal.exitStatus === undefined;
}
