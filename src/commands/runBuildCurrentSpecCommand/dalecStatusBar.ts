import * as vscode from 'vscode';
import { DalecDocumentTracker } from './dalecDocumentTracker';

/**
 * Manages a status bar item that shows Dalec spec recognition status
 * for the currently active document.
 */
export class DalecStatusBarManager implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private previousStatus: boolean | undefined;

  constructor(private readonly tracker: DalecDocumentTracker) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.name = 'Dalec Spec Status';

    this.disposables.push(
      this.statusBarItem,
      // Update when active editor changes
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      // Update when tracker re-evaluates documents (including config changes)
      tracker.onDidChange((uri) => this.onDocumentChanged(uri)),
    );

    // Initial update
    this.update();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  private onDocumentChanged(changedUri: vscode.Uri) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }

    // Only update if the changed document is the active one
    if (activeEditor.document.uri.toString() === changedUri.toString()) {
      this.update(true);
    }
  }

  private update(fromConfigChange = false) {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this.statusBarItem.hide();
      this.previousStatus = undefined;
      return;
    }

    const doc = editor.document;

    // Only show for YAML files
    if (doc.languageId !== 'yaml' && doc.languageId !== 'yml') {
      this.statusBarItem.hide();
      this.previousStatus = undefined;
      return;
    }

    const isDalec = this.tracker.isDalecDocument(doc);
    const firstLine = doc.lineCount > 0 ? doc.lineAt(0).text.trim() : '';
    const hasSyntaxDirective = /^#\s*syntax\s*=/i.test(firstLine);

    // Show notification if status changed due to config update
    if (fromConfigChange && this.previousStatus !== undefined && this.previousStatus !== isDalec) {
      if (isDalec) {
        void vscode.window.showInformationMessage(
          `"${doc.fileName.split('/').pop()}" is now recognized as a Dalec spec.`
        );
      } else {
        void vscode.window.showWarningMessage(
          `"${doc.fileName.split('/').pop()}" is no longer recognized as a Dalec spec. ` +
          'Check your Dalec syntax directive settings.'
        );
      }
    }

    this.previousStatus = isDalec;

    if (isDalec) {
      this.statusBarItem.text = '$(check) Dalec';
      this.statusBarItem.tooltip = 'This file is recognized as a Dalec spec';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.command = {
        command: 'dalec-vscode-tools.buildCurrentSpec',
        title: 'Build Dalec Spec',
      };
    } else if (hasSyntaxDirective) {
      // Has a syntax directive but not recognized
      this.statusBarItem.text = '$(warning) Dalec';
      this.statusBarItem.tooltip = 
        'This file has a syntax directive but is not recognized as a Dalec spec.\n' +
        'Click to open settings and configure accepted directives.';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.statusBarItem.command = {
        command: 'workbench.action.openSettings',
        title: 'Open Dalec Settings',
        arguments: ['dalec-spec.syntaxDirectives'],
      };
    } else {
      // Regular YAML file, no syntax directive
      this.statusBarItem.hide();
      return;
    }

    this.statusBarItem.show();
  }
}
