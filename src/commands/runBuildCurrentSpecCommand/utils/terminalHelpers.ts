import * as vscode from 'vscode';

export function getTerminalCommentPrefix(): string {
  const shell = vscode.env.shell?.toLowerCase() ?? '';
  if (shell.includes('cmd.exe')) {
    return 'REM';
  }
  return '#';
}
