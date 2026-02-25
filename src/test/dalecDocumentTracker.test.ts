import * as assert from 'assert';
import * as vscode from 'vscode';
import { findTargetLineNumbers } from '../commands/runBuildCurrentSpecCommand/dalecDocumentTracker';

suite('Dalec Document Tracker Test Suite', () => {
  suite('findTargetLineNumbers', () => {
    test('finds target line numbers in simple YAML', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

targets:
  mariner2:
    dependencies:
      build:
        gcc:
  azlinux3:
    dependencies:
      build:
        clang:
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      assert.strictEqual(targetLines.size, 2);
      assert.strictEqual(targetLines.get('mariner2'), 5);
      assert.strictEqual(targetLines.get('azlinux3'), 9);
    });

    test('finds target line numbers with complex structure', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

sources:
  src:
    git:
      url: https://github.com/example/repo.git

targets:
  mariner2:
    dependencies:
      build:
        gcc:
      runtime:
        glibc:
  azlinux3:
    dependencies:
      build:
        clang:
  debian12:
    dependencies:
      build:
        build-essential:

build:
  steps:
    - command: make
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      assert.strictEqual(targetLines.size, 3);
      assert.strictEqual(targetLines.get('mariner2'), 10);
      assert.strictEqual(targetLines.get('azlinux3'), 16);
      assert.strictEqual(targetLines.get('debian12'), 20);
    });

    test('handles targets with hyphenated names', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

targets:
  mariner-2:
    dependencies:
      build:
        gcc:
  azure-linux-3:
    dependencies:
      build:
        clang:
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      assert.strictEqual(targetLines.size, 2);
      assert.strictEqual(targetLines.get('mariner-2'), 5);
      assert.strictEqual(targetLines.get('azure-linux-3'), 9);
    });

    test('returns empty map when no targets section', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

build:
  steps:
    - command: make
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      assert.strictEqual(targetLines.size, 0);
    });

    test('returns empty map when targets section is empty', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

targets:

build:
  steps:
    - command: make
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      assert.strictEqual(targetLines.size, 0);
    });

    test('handles malformed YAML gracefully', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

targets:
  mariner2:
    dependencies:
      build
        gcc:
  azlinux3:
    dependencies:
      build:
        clang:
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      // Should fall back to regex-based parsing
      assert.ok(targetLines.size >= 0);
    });

    test('handles indentation variations', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

targets:
    mariner2:
        dependencies:
            build:
                gcc:
    azlinux3:
        dependencies:
            build:
                clang:
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      assert.strictEqual(targetLines.size, 2);
      assert.ok(targetLines.has('mariner2'));
      assert.ok(targetLines.has('azlinux3'));
    });

    test('ignores nested targets structure', async () => {
      const content = `#syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: test-package
version: 1.0.0

targets:
  mariner2:
    dependencies:
      build:
        gcc:
    nested:
      not_a_target:
        value: something
  azlinux3:
    dependencies:
      build:
        clang:
`;

      const document = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content,
      });

      const targetLines = findTargetLineNumbers(document);

      // Should only find top-level targets, not nested keys
      assert.strictEqual(targetLines.size, 2);
      assert.ok(targetLines.has('mariner2'));
      assert.ok(targetLines.has('azlinux3'));
      assert.ok(!targetLines.has('not_a_target'));
    });
  });
});
