import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { getBuildTerminalName, getOrCreateTerminal } from '../commands/runBuildCurrentSpecCommand/utils/terminalHelpers';

suite('Terminal Helpers Test Suite', () => {
  const createdTerminals: vscode.Terminal[] = [];

  teardown(async () => {
    for (const terminal of createdTerminals.splice(0)) {
      terminal.dispose();
      await waitForTerminalClose(terminal);
    }
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
    await waitForTerminalClose(terminal);

    const recreated = getOrCreateTerminal(name, {});
    createdTerminals.push(recreated);

    assert.notStrictEqual(recreated, terminal);
  });
});

async function waitForTerminalClose(terminal: vscode.Terminal): Promise<void> {
  if (!vscode.window.terminals.includes(terminal)) {
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      const subscription = vscode.window.onDidCloseTerminal((closed) => {
        if (closed === terminal) {
          subscription.dispose();
          resolve();
        }
      });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);

  assert.strictEqual(
    vscode.window.terminals.includes(terminal),
    false,
    'Expected terminal to be closed after dispose().',
  );
}
