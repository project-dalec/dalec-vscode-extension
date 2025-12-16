import * as vscode from 'vscode';
import { DalecDocumentTracker } from '../dalecDocumentTracker';

export async function resolveDalecDocument(
  uri: vscode.Uri | undefined,
  tracker: DalecDocumentTracker,
): Promise<vscode.TextDocument | undefined> {
  if (uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (tracker.isDalecDocument(doc)) {
      return doc;
    }
    void vscode.window.showErrorMessage('Selected file is not recognized as a Dalec spec.');
    return undefined;
  }

  const activeDoc = vscode.window.activeTextEditor?.document;
  if (activeDoc && tracker.isDalecDocument(activeDoc)) {
    return activeDoc;
  }

  void vscode.window.showErrorMessage('Open a Dalec spec (first line must start with #syntax=...) to continue.');
  return undefined;
}

export async function isValidDalecDoc(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const doc = editor.document;

  // Only allow YAML files
  if (doc.languageId !== "yaml") {
    vscode.window.showWarningMessage("Dalec can only run on YAML files.");
    return;
  }

  const firstLine = doc.lineAt(0).text.trim();

  const isDalec =
    firstLine.startsWith('# syntax=ghcr.io/project-dalec/dalec/frontend:latest') ||
    (firstLine.startsWith('#') && firstLine.includes('-dalec')) ||
    (firstLine.startsWith('#') && firstLine.includes('/dalec/'));

  if (!isDalec) {
    vscode.window.showInformationMessage(
      "This YAML file is not a Dalec file (missing Dalec syntax header)."
    );
    return;
  }
}
