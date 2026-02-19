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
  // Rewrite source paths in stackTrace responses
  if (message.command === 'stackTrace' && message.body?.stackFrames) {
    for (const frame of message.body.stackFrames) {
      if (frame.source && isSpecSourcePath(frame.source.path, absoluteSpecPath, relativeSpecPath)) {
        frame.source.path = absoluteSpecPath;
        frame.source.sourceReference = 0;
      }
    }
  }

  // Rewrite source paths in output events (e.g. error output in debug console)
  if (message.type === 'event' && message.event === 'output' && message.body?.source) {
    if (isSpecSourcePath(message.body.source.path, absoluteSpecPath, relativeSpecPath)) {
      message.body.source.path = absoluteSpecPath;
      message.body.source.sourceReference = 0;
    }
  }

  // Rewrite source paths in breakpoint events
  if (message.type === 'event' && message.event === 'breakpoint' && message.body?.breakpoint?.source) {
    if (isSpecSourcePath(message.body.breakpoint.source.path, absoluteSpecPath, relativeSpecPath)) {
      message.body.breakpoint.source.path = absoluteSpecPath;
      message.body.breakpoint.source.sourceReference = 0;
    }
  }
}

/**
 * Checks whether a path from the DAP server refers to the spec file.
 *
 * The DAP server may report source paths in several forms:
 *  - The exact relative path we sent via setBreakpoints
 *  - Just the filename (basename)
 *  - An absolute path resolved against the build context directory (e.g.
 *    AppData/Local/Temp/dalec-empty-context/<specfile>.yaml)
 *
 * This function handles all those cases so the path can be mapped back to
 * the real spec file on disk.
 */
function isSpecSourcePath(
  candidatePath: string | undefined,
  absoluteSpecPath: string,
  relativeSpecPath: string,
): boolean {
  if (!candidatePath) {
    return false;
  }
  if (candidatePath === relativeSpecPath) {
    return true;
  }
  if (candidatePath === path.basename(relativeSpecPath)) {
    return true;
  }
  try {
    if (path.resolve(candidatePath) === path.resolve(absoluteSpecPath)) {
      return true;
    }
  } catch {
    // ignore resolution errors
  }
  // Basename match — catches the temp-context case where Docker resolves the
  // spec against the build context and returns a path like
  // AppData/Local/Temp/dalec-empty-context/<specfile>.yaml
  if (path.basename(candidatePath) === path.basename(absoluteSpecPath)) {
    return true;
  }
  return false;
}

export function logDapTraffic(direction: string, message: any): void {
  const dalecOutputChannel = getDalecOutputChannel();
  const line = `[Dalec][DAP][${direction}] ${JSON.stringify(message)}`;
  dalecOutputChannel.appendLine(line);
}
