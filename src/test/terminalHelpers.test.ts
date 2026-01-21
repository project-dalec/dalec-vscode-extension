import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { getBuildTerminalName, getOrCreateTerminal } from '../commands/runBuildCurrentSpecCommand/utils/terminalHelpers';

suite('Terminal Helpers Test Suite', () => {
  const createdTerminals: vscode.Terminal[] = [];

  teardown(async () => {
    const terminals = createdTerminals.splice(0);
    await Promise.all(
      terminals.map(async (terminal) => {
        terminal.dispose();
        await waitForTerminalClose(terminal);
      }),
    );
  });

  test('getBuildTerminalName uses workspace-relative spec path when available', () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      assert.fail('Expected a workspace root for terminal helper tests.');
      return;
    }

    const specPath = path.join(workspaceRoot, 'specs', 'example.yaml');
    const specUri = vscode.Uri.file(specPath);
    const target = 'build';

    const expectedRelative = path.relative(workspaceRoot, specPath);
    const expectedLabel = expectedRelative && expectedRelative !== '.' ? expectedRelative : path.basename(specPath);
    const expectedName = `Dalec Build (${target}) - ${expectedLabel}`;

    assert.strictEqual(getBuildTerminalName(target, specUri), expectedName);
  });

  test('getOrCreateTerminal reuses a terminal with the same name', async () => {
    const name = 'Dalec Build (reuse) - example.yaml';
    const terminal = getOrCreateTerminal(name, {});
    createdTerminals.push(terminal);

    const reused = getOrCreateTerminal(name, {});

    assert.strictEqual(reused, terminal);
  });

  test('getOrCreateTerminal matches terminals with numeric suffixes', async () => {
    const uniqueId = Date.now().toString(36);
    const baseName = `Dalec Build (suffix-${uniqueId}) - example.yaml`;
    const terminal = vscode.window.createTerminal({ name: `${baseName} (1)` });
    createdTerminals.push(terminal);

    const reused = getOrCreateTerminal(baseName, {});

    assert.strictEqual(reused, terminal);
  });

  test('getOrCreateTerminal recreates terminals after they are closed', async () => {
    const name = 'Dalec Build (cleanup) - example.yaml';
    const terminal = getOrCreateTerminal(name, {});
    createdTerminals.push(terminal);

    terminal.dispose();
    const closed = await waitForTerminalClose(terminal);
    if (!closed) {
      // Allow slow terminal shutdown without failing the test.
      return;
    }

    const recreated = getOrCreateTerminal(name, {});
    createdTerminals.push(recreated);

    assert.notStrictEqual(recreated, terminal);
  });
});

async function waitForTerminalClose(terminal: vscode.Terminal, timeoutMs = 2000): Promise<boolean> {
  if (!vscode.window.terminals.includes(terminal)) {
    return true;
  }

  let closed = false;
  await Promise.race([
    new Promise<void>((resolve) => {
      const subscription = vscode.window.onDidCloseTerminal((closedTerminal) => {
        if (closedTerminal === terminal) {
          closed = true;
          subscription.dispose();
          resolve();
        }
      });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  return closed || !vscode.window.terminals.includes(terminal);
}
