import * as path from 'path';
import { getDalecOutputChannel } from '../utils/dockerHelpers';

export function rewriteOutboundMessage(message: any, absoluteSpecPath: string, relativeSpecPath: string): void {
  if (message.command === 'setBreakpoints' && message.arguments?.source?.path) {
    if (path.resolve(message.arguments.source.path) === path.resolve(absoluteSpecPath)) {
      // Rewrite the absolute path from VS Code to the relative path Docker expects
      message.arguments.source.path = relativeSpecPath;
      // modify names too if present?
      if (message.arguments.source.name) {
        message.arguments.source.name = path.basename(relativeSpecPath);
      }
      message.arguments.source.sourceReference = 0;
    }
  }
}

export function rewriteInboundMessage(message: any, absoluteSpecPath: string, relativeSpecPath: string): void {
  if (message.command === 'stackTrace' && message.body && message.body.stackFrames) {
    for (const frame of message.body.stackFrames) {
      if (frame.source) {
        if (frame.source.path === relativeSpecPath || frame.source.path === path.basename(relativeSpecPath)) {
          frame.source.path = absoluteSpecPath;
          frame.source.sourceReference = 0;
        }
      }
    }
  }
}

export function logDapTraffic(direction: string, message: any): void {
  const dalecOutputChannel = getDalecOutputChannel();
  const line = `[Dalec][DAP][${direction}] ${JSON.stringify(message)}`;
  dalecOutputChannel.appendLine(line);
}
