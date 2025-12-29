/**
 * Shell execution utilities for secure command execution.
 * Uses child_process.execFile for array-based arguments to prevent shell injection.
 */

import { execFile as nodeExecFile, execFileSync as nodeExecFileSync } from 'child_process';
import { promisify } from 'util';
import { Errorable } from './errorable';

const execFileAsync = promisify(nodeExecFile);

export interface ShellResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ShellOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  exitCodeBehaviour?: NonZeroExitCodeBehaviour;
  maxBuffer?: number; // Maximum stdout/stderr buffer size in bytes (default: 20MB)
}

export enum NonZeroExitCodeBehaviour {
  Succeed,
  Fail,
}

/**
 * Extract exit code from execFile/execFileSync error objects.
 * Node.js uses different property names for exit codes:
 * - execFile (async) errors have 'code' property
 * - execFileSync (sync) errors have 'status' property
 */
function getExitCode(error: any, isSync: boolean): number {
  return isSync ? (error.status ?? 1) : (error.code ?? 1);
}

/**
 * Execute a file with arguments using Node's child_process.execFile.
 * This doesn't invoke a shell and prevents shell injection.
 * Use this for all command execution where arguments may come from user input or file paths.
 * @param file The executable file to run
 * @param args Array of arguments (no shell interpretation)
 * @param options Execution options
 * @returns An Errorable containing the shell result
 */
export async function execFile(
  file: string,
  args: string[],
  options?: ShellOptions,
): Promise<Errorable<ShellResult>> {
  try {
    const execOptions: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {
      maxBuffer: options?.maxBuffer ?? 20 * 1024 * 1024, // Default 20MB for large Docker output
    };
    
    if (options?.cwd) {
      execOptions.cwd = options.cwd;
    }

    if (options?.env) {
      execOptions.env = { ...process.env, ...options.env };
    }

    const { stdout, stderr } = await execFileAsync(file, args, execOptions);

    const result: ShellResult = {
      code: 0,
      stdout: stdout || '',
      stderr: stderr || '',
    };

    return { succeeded: true, result };
  } catch (ex: any) {
    const exitCodeBehaviour = options?.exitCodeBehaviour ?? NonZeroExitCodeBehaviour.Fail;
    const code = getExitCode(ex, false); // execFile errors use 'code' property
    const stdout = ex.stdout || '';
    const stderr = ex.stderr || '';

    if (exitCodeBehaviour === NonZeroExitCodeBehaviour.Succeed) {
      return {
        succeeded: true,
        result: { code, stdout, stderr },
      };
    }

    return {
      succeeded: false,
      error: `Command "${file} ${args.join(' ')}" failed with exit code ${code}.\nStdout:\n${stdout}\nStderr:\n${stderr}`,
    };
  }
}

/**
 * Execute a file with arguments synchronously using Node's child_process.execFileSync.
 * This doesn't invoke a shell and prevents shell injection.
 * Use this for synchronous command execution where arguments may come from user input or file paths.
 * @param file The executable file to run
 * @param args Array of arguments (no shell interpretation)
 * @param options Execution options
 * @returns An Errorable containing the shell result
 */
export function execFileSync(
  file: string,
  args: string[],
  options?: ShellOptions,
): Errorable<ShellResult> {
  try {
    const execOptions: { cwd?: string; env?: NodeJS.ProcessEnv; encoding: BufferEncoding; maxBuffer?: number } = {
      encoding: 'utf8',
      maxBuffer: options?.maxBuffer ?? 20 * 1024 * 1024, // Default 20MB for large Docker output
    };

    if (options?.cwd) {
      execOptions.cwd = options.cwd;
    }

    if (options?.env) {
      execOptions.env = { ...process.env, ...options.env };
    }

    const stdout = nodeExecFileSync(file, args, execOptions);

    const result: ShellResult = {
      code: 0,
      stdout: stdout || '',
      stderr: '',
    };

    return { succeeded: true, result };
  } catch (ex: any) {
    const exitCodeBehaviour = options?.exitCodeBehaviour ?? NonZeroExitCodeBehaviour.Fail;
    const code = getExitCode(ex, true); // execFileSync errors use 'status' property
    const stdout = ex.stdout || '';
    const stderr = ex.stderr || '';

    if (exitCodeBehaviour === NonZeroExitCodeBehaviour.Succeed) {
      return {
        succeeded: true,
        result: { code, stdout, stderr },
      };
    }

    return {
      succeeded: false,
      error: `Command "${file} ${args.join(' ')}" failed with exit code ${code}.\nStdout:\n${stdout}\nStderr:\n${stderr}`,
    };
  }
}
