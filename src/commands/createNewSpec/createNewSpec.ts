import * as vscode from 'vscode';

export async function createNewSpec() {
  const document = await vscode.workspace.openTextDocument({
    language: 'yaml',
    content: `# syntax=ghcr.io/project-dalec/dalec/frontend:latest
name: my-package
version: 0.0.1
revision: "1"
description: A new Dalec package
license: MIT
website: https://github.com/project-dalec/dalec

sources:
  src:
    git:
      url: https://github.com/example/repo
      commit: HEAD

build:
  steps:
    - command:
        - ./build.sh

tests:
  - name: basic-test
    steps:
      - command:
          - ./test.sh
`
  });
  await vscode.window.showTextDocument(document);
}
