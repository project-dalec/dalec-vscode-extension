import * as vscode from 'vscode';
import { getDalecOutputChannel } from '../utils/dockerHelpers';
import { getWorkspaceRelativeFsPath } from '../utils/pathHelpers';

export function rewriteSourcePathsForBreakpoints(message: any): void {
  if (message.command === 'setBreakpoints' && Array.isArray(message.arguments?.breakpoints)) {
    for (const bp of message.arguments.breakpoints) {
      if (bp.source && typeof bp.source.path === 'string') {
        const originalPath = bp.source.path;
        const rewrittenPath = getWorkspaceRelativeFsPath(originalPath);
        bp.source.path = rewrittenPath;
      }
    }
  }
}

export function logDapTraffic(direction: string, message: any): void {
  const dalecOutputChannel = getDalecOutputChannel();
  const line = `[Dalec][DAP][${direction}] ${JSON.stringify(message)}`;
  dalecOutputChannel.appendLine(line);
}
