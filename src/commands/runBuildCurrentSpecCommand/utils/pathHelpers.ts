import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

let workspaceRoot: string | undefined;

export function getWorkspaceRootForUri(uri?: vscode.Uri): string | undefined {
  if (uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      return folder.uri.fsPath;
    }
    // If the file is not part of a workspace folder, use its directory as the root
    return path.dirname(uri.fsPath);
  }
  return workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getWorkspaceRootForPath(filePath: string): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return folder?.uri.fsPath;
}

export function getWorkspaceRelativeFsPath(filePath: string): string {
  const root = getWorkspaceRootForPath(filePath);
  if (root && filePath.startsWith(root)) {
    // If specific file is in workspace, return path relative to workspace root
    // e.g. /ws/foo.yaml -> foo.yaml
    const rel = path.relative(root, filePath);
    return rel;
  }
  return filePath;
}

export function getWorkspaceRelativeSpecPath(uri: vscode.Uri): string {
  return uri.fsPath;
}

export function getSpecWorkspacePath(document: vscode.TextDocument): string {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  return folder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
}

export function expandUserPath(input: string): string {
  if (!input) {
    return input;
  }
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function resolveContextReference(input: string, document: vscode.TextDocument): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === '.' || trimmed === './') {
    return getSpecWorkspacePath(document);
  }

  if (isRemoteContextReference(trimmed)) {
    return trimmed;
  }

  const expanded = expandUserPath(trimmed);
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }

  const base = getSpecWorkspacePath(document);
  return path.resolve(base, expanded);
}

function isRemoteContextReference(value: string): boolean {
  const lowered = value.toLowerCase();
  if (lowered.startsWith('type=')) {
    return true;
  }
  if (/^[a-z0-9+.-]+:\/\//i.test(value)) {
    return true;
  }
  if (value.startsWith('${')) {
    return true;
  }
  if (/[,:]/.test(value) && value.includes('=') && !value.includes(path.sep)) {
    return true;
  }
  return false;
}
