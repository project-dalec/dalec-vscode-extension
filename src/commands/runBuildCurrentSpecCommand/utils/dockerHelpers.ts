import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

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
  imageName?: string;
  imageTag?: string;
}

export type DockerCommandMode = 'build' | 'dap';

let dalecOutputChannel: vscode.OutputChannel | undefined;

export interface DalecResolveResult {
  name?: string;
  version?: string;
  revision?: string;
}

export interface DalecResolveOptions {
  target?: string;
  buildArgs?: Map<string, string>;
  buildContexts?: Map<string, string>;
}

/**
 * Resolves image metadata (name, version, revision) from a Dalec YAML file
 * using the dalec.resolve command with docker buildx.
 *
 * This function executes: docker buildx build --call dalec.resolve,format=json -< path/to/dalecfile.yaml
 *
 * The dalec.resolve command processes the Dalec spec file and returns structured metadata
 * about the image that would be built, including the package name, version, and revision.
 * This metadata is used to construct appropriate image tags for the build.
 *
 * @param specFilePath - Absolute path to the Dalec YAML specification file
 * @param options - Optional build settings to ensure metadata is resolved with actual build args/contexts
 * @returns Promise resolving to an object containing name, version, and revision fields.
 *          Fields may be undefined if not present in the spec or if resolution fails.
 *
 * @example
 * const metadata = await resolveDalecImageMetadata('/path/to/dalec-spec.yaml');
 * if (metadata.name && metadata.version) {
 *   const imageTag = `${metadata.name}:${metadata.version}`;
 * }
 */
export async function resolveDalecImageMetadata(
  specFilePath: string,
  options: DalecResolveOptions = {},
): Promise<DalecResolveResult> {
  try {
    // Get the directory containing the spec file to use as the working directory
    const contextPath = path.dirname(specFilePath);

    // Retrieve the configured buildx command (defaults to 'docker buildx')
    // This allows users to customize the docker command if needed
    const buildxSetting = vscode.workspace.getConfiguration('dalec-spec').get('buildxCommand', 'docker buildx').trim();
    const parts = buildxSetting.split(/\s+/);
    const binary = parts.shift() || 'docker';

    // Construct the command arguments for dalec.resolve
    // Use -f to specify the spec file and . as the context
    const args = [...parts, 'build', '--call', 'dalec.resolve,format=json'];
    if (options.target) {
      args.push('--target', options.target);
    }
    if (options.buildArgs && options.buildArgs.size > 0) {
      args.push(...formatBuildArgs(options.buildArgs));
    }
    if (options.buildContexts && options.buildContexts.size > 0) {
      args.push(...buildContextArgs(options.buildContexts));
    }
    args.push('-f', specFilePath, '.');

    // Execute the command and capture output
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const childProcess = spawn(binary, args, {
        cwd: contextPath,
        env: {
          ...process.env,
          BUILDX_EXPERIMENTAL: '1', // Enable experimental buildx features required for --call
        },
      });

      // Accumulate stdout and stderr as the process runs
      let stdout = '';
      let stderr = '';

      // Capture standard output (where the JSON result will be)
      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Capture standard error (for logging and error handling)
      childProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process spawn errors (e.g., binary not found)
      childProcess.on('error', (error: Error) => {
        reject(error);
      });

      // Handle process completion
      childProcess.on('close', (code: number | null) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
        }
      });
    });

    // Parse the JSON output from dalec.resolve
    const parsed = JSON.parse(result.stdout);

    // Validate that the result is an array with at least one element
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const errorMsg = `Unexpected response format from dalec.resolve: ${typeof parsed === 'object' ? 'empty array or non-array object' : typeof parsed}`;
      getDalecOutputChannel().appendLine(`[Dalec] ${errorMsg}`);
      void vscode.window.showWarningMessage(`Dalec resolve returned unexpected format. Check output for details.`);
      return {};
    }

    // Extract metadata fields from the parsed result
    // Convert revision to string if present, as it may be returned as a number
    const metadata: DalecResolveResult = {
      name: parsed[0].name || undefined,
      version: parsed[0].version || undefined,
      revision: parsed[0].revision !== undefined ? String(parsed[0].revision) : undefined,
    };

    // Validate that all expected metadata fields are present
    // Missing fields may indicate an incomplete or invalid Dalec spec
    const missingFields: string[] = [];
    if (!metadata.name) {
      missingFields.push('name');
    }
    if (!metadata.version) {
      missingFields.push('version');
    }
    if (!metadata.revision) {
      missingFields.push('revision');
    }

    // Warn the user if any required fields are missing
    // This helps guide them to fix their Dalec spec file
    if (missingFields.length > 0) {
      const message = `Warning: The following fields are missing or empty in your Dalec spec: ${missingFields.join(', ')}. ` +
                      `This may affect image tagging. Please ensure these fields are defined in your YAML file.`;
      void vscode.window.showWarningMessage(message);
      getDalecOutputChannel().appendLine(`[Dalec] ${message}`);
    }

    return metadata;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    getDalecOutputChannel().appendLine(`[Dalec] Failed to resolve image metadata: ${errorMessage}`);

    void vscode.window.showErrorMessage(
      `Failed to resolve Dalec image metadata. Please ensure your YAML file is valid and Docker is running. Error: ${errorMessage}`
    );

    return {};
  }
}


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
  // Use absolute path for -f to align with VS Code's breakpoints source path
  args.push('--target', inputs.target, '-f', inputs.specFile);

  // Determine output behavior based on target type and configuration
  const outputFlag = getOutputFlagForTarget(inputs.target);
  const isContainerTarget = inputs.target === 'container' || inputs.target.endsWith('/container');

  if (outputFlag) {
    // Use configured output flag (e.g., type=local,dest=./rpm-out)
    args.push('--output', outputFlag);
  } else if (isContainerTarget) {
    // Only add image tag for container targets when no custom output is specified
    // This exports the image to docker (default behavior of -t)
    if (inputs.imageName && inputs.imageTag) {
      args.push('-t', `${inputs.imageName}:${inputs.imageTag}`);
    } else if (inputs.imageName) {
      args.push('-t', inputs.imageName);
    }
  }
  // For non-container targets without a configured output flag, let docker buildx use its default behavior

  if (inputs.buildArgs && inputs.buildArgs.size > 0) {
    args.push(...formatBuildArgs(inputs.buildArgs));
  }
  if (inputs.buildContexts && inputs.buildContexts.size > 0) {
    args.push(...buildContextArgs(inputs.buildContexts));
  }
  args.push(inputs.context);
  return { binary, args };
}

/**
 * Gets the configured output flag for a given target.
 * Checks the configuration for matching target patterns and returns the output flag.
 * Substitutes ${baseDir} variable with the configured outputBaseDirectory.
 * 
 * @param target - The target name (e.g., 'rpm', 'mariner2/rpm', 'container')
 * @returns The output flag value (without '--output' prefix) or undefined if no match
 */
function getOutputFlagForTarget(target: string): string | undefined {
  const config = vscode.workspace.getConfiguration('dalec-spec');
  const defaultOutputFlags = config.get<Record<string, string>>('defaultOutputFlags', {});
  const baseDir = config.get<string>('outputBaseDirectory', '.dalec-output');

  let flag: string | undefined;

  // Check for exact match first
  if (target in defaultOutputFlags) {
    flag = defaultOutputFlags[target];
  } else {
    // Check if target ends with a known suffix (e.g., mariner2/rpm -> rpm)
    for (const [pattern, flagValue] of Object.entries(defaultOutputFlags)) {
      if (target === pattern || target.endsWith(`/${pattern}`)) {
        flag = flagValue;
        break;
      }
    }
  }

  if (!flag) {
    return undefined; // Return undefined for empty strings or no match
  }

  // Substitute ${baseDir} variable with the configured base directory
  const substituted = flag.replace(/\$\{baseDir\}/g, baseDir);
  return substituted || undefined;
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
