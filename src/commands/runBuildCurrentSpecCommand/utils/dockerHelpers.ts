import * as vscode from 'vscode';
import * as path from 'path';

export interface DockerCommand {
  binary: string;
  args: string[];
}

export interface DockerCommandInputs {
  mode: DockerCommandMode;
  target: string;
  specFile: string;
  context: string;
  buildArgs?: Map<string, string>;
  buildContexts?: Map<string, string>;
  noCache?: boolean;
}

export type DockerCommandMode = 'build' | 'dap';

let dalecOutputChannel: vscode.OutputChannel | undefined;

export function createDockerBuildxCommand(inputs: DockerCommandInputs): DockerCommand {
  const buildxSetting = vscode.workspace.getConfiguration('dalec-spec').get('buildxCommand', 'docker buildx').trim();
  const parts = buildxSetting.split(/\s+/);
  const binary = parts.shift() || 'docker';
  const args = parts;
  if (inputs.mode === 'dap') {
    args.push('dap', 'build');
  } else {
    args.push('build');
  }
  args.push('--target', inputs.target, '-f', getWorkspaceRelativeFsPath(inputs.specFile));
  if (inputs.buildArgs && inputs.buildArgs.size > 0) {
    args.push(...formatBuildArgs(inputs.buildArgs));
  }
  if (inputs.buildContexts && inputs.buildContexts.size > 0) {
    args.push(...buildContextArgs(inputs.buildContexts));
  }
  if (inputs.noCache) {
    args.push('--no-cache');
  }
  const contextPathArg = isRemoteContextReference(inputs.context)
    ? inputs.context
    : getWorkspaceRelativeFsPath(inputs.context);
  args.push(contextPathArg);
  return { binary, args };
}

export function buildContextArgs(contexts: Map<string, string>): string[] {
  const entries = [...contexts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const args: string[] = [];
  for (const [name, ctxPath] of entries) {
    const value = isRemoteContextReference(ctxPath)
      ? ctxPath
      : getWorkspaceRelativeFsPath(ctxPath);
    args.push('--build-context', `${name}=${value}`);
  }
  return args;
}

export function isRemoteContextReference(value: string): boolean {
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

export function formatBuildArgs(args: Map<string, string>): string[] {
  const entries = [...args.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const flags: string[] = [];
  for (const [key, value] of entries) {
    flags.push('--build-arg', `${key}=${value}`);
  }
  return flags;
}

export function logDockerCommand(scope: string, command: DockerCommand, options?: { toDebugConsole?: boolean }): string {
  const formatted = formatDockerCommand(command);
  const line = `[Dalec] ${scope}: ${formatted}`;
  getDalecOutputChannel().appendLine(line);
  if (options?.toDebugConsole) {
    vscode.debug.activeDebugConsole?.appendLine(line);
  }
  return formatted;
}

function getWorkspaceRelativeFsPath(filePath: string): string {
  return filePath;
}

export function formatDockerCommand(command: DockerCommand): string {
  return [command.binary, ...command.args].map(quote).join(' ');
}

export function quote(value: string): string {
  if (value.includes(' ')) {
    return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
  }
  return value;
}

export function getDockerErrorMessage(error: unknown): string {
  const baseMessage = error instanceof Error ? error.message : String(error);
  
  // Check for common Docker-related errors
  if (baseMessage.includes('ENOENT') || baseMessage.includes('command not found')) {
    return 'Docker is not installed or not in your PATH. Please install Docker and ensure it is accessible from the command line.';
  }
  
  if (baseMessage.includes('ECONNREFUSED') || baseMessage.includes('Cannot connect to the Docker daemon')) {
    return 'Docker daemon is not running. Please start Docker Desktop or the Docker service and try again.';
  }
  
  if (baseMessage.includes('permission denied')) {
    return 'Permission denied when accessing Docker. You may need to run VS Code with appropriate permissions or add your user to the docker group.';
  }
  
  if (baseMessage.includes('buildx') && (baseMessage.includes('unknown') || baseMessage.includes('not found'))) {
    return 'Docker buildx is not available. Please ensure you have Docker with buildx support installed (Docker 19.03 or later).';
  }
  
  if (baseMessage.includes('BUILDX_EXPERIMENTAL')) {
    return 'Docker buildx experimental features are required but not enabled. Please update your Docker installation.';
  }
  
  // Generic fallback with the original error
  return `Failed to query Dalec targets: ${baseMessage}. Please ensure Docker is installed, running, and accessible.`;
}

export function getDalecOutputChannel(): vscode.OutputChannel {
  if (!dalecOutputChannel) {
    dalecOutputChannel = vscode.window.createOutputChannel('Dalec');
  }
  return dalecOutputChannel;
}
