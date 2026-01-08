import { window, Terminal} from 'vscode';

// Module-level variable to store the shared Dalec build terminal
let dalecBuildTerminal: Terminal | undefined;

/**
 * Gets or creates the shared Dalec Extension Session terminal.
 * Reuses an existing terminal if it's still open, otherwise creates a new one.
 */
export function getDalecSharedTerminalSession(cwd?: string): Terminal {
  if (!dalecBuildTerminal || dalecBuildTerminal.exitStatus) {
    dalecBuildTerminal = window.createTerminal({
      name: 'Dalec Extension Session',
      cwd,
      env: {
        ...process.env,
        BUILDX_EXPERIMENTAL: '1',
      },
    });
  }

  return dalecBuildTerminal;
}
