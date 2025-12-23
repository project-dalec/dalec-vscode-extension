// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DalecCodeLensProvider, DalecDebugAdapterDescriptorFactory, DalecDebugAdapterTrackerFactory, DalecDebugConfigurationProvider, LastDalecActionState, runBuildCommand } from './commands/runBuildCurrentSpecCommand/runBuildCommand';
import { DalecDocumentTracker, DalecSchemaProvider } from './commands/runBuildCurrentSpecCommand/dalecDocumentTracker';
import { rerunLastAction } from './commands/reRunLastAction/reRunLastAction';

const DEBUG_TYPE = 'dalec-buildx';

let dalecOutputChannel: vscode.OutputChannel | undefined;
let workspaceRoot: string | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// dalec related setup
	const tracker = new DalecDocumentTracker();
	context.subscriptions.push(tracker);
	const lastAction = new LastDalecActionState();
	dalecOutputChannel = vscode.window.createOutputChannel('Dalec Spec');
	context.subscriptions.push(dalecOutputChannel);

	workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

	const schemaProvider = new DalecSchemaProvider(context, tracker);
	await schemaProvider.initialize();
	context.subscriptions.push(schemaProvider);

	const codeLensProvider = new DalecCodeLensProvider(tracker, lastAction);
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider([{ language: 'yaml' }, { language: 'yml' }], codeLensProvider),
		codeLensProvider,
	);

	const debugProvider = new DalecDebugConfigurationProvider(tracker);
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, debugProvider),
		vscode.debug.registerDebugAdapterDescriptorFactory(
		DEBUG_TYPE,
		new DalecDebugAdapterDescriptorFactory(),
		),
		vscode.debug.registerDebugAdapterTrackerFactory(
		DEBUG_TYPE,
		new DalecDebugAdapterTrackerFactory(),
		),
	);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "dalec-vscode-tools" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('dalec-vscode-tools.buildCurrentSpec', (uri?: vscode.Uri) =>
      runBuildCommand(uri, tracker, lastAction),
    );

	vscode.commands.registerCommand('dalec-vscode-tools.rerunLastAction', () => rerunLastAction(tracker, lastAction)),
    vscode.commands.registerCommand('dalec-vscode-tools.rerunLastActionBuild', () =>
      rerunLastAction(tracker, lastAction, 'build'),
    ),
    vscode.commands.registerCommand('dalec-vscode-tools.rerunLastActionDebug', () =>
      rerunLastAction(tracker, lastAction, 'debug'),
    ),

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

