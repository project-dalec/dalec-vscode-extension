import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { DalecDocumentTracker } from '../dalecDocumentTracker';
import { resolveContextReference } from '../utils/pathHelpers';

const emptyContextDirPath = path.join(os.tmpdir(), 'dalec-empty-context');
let emptyContextDirReady: Promise<string> | undefined;
const contextSelectionCache = new Map<string, ContextSelection>();
const argsSelectionCache = new Map<string, ArgsSelection>();

export interface ContextSelection {
  defaultContextPath: string;
  additionalContexts: Map<string, string>;
}

export interface ArgsSelection {
  values: Map<string, string>;
}

export async function collectContextSelection(
  document: vscode.TextDocument,
  tracker: DalecDocumentTracker,
  cachedValue?: ContextSelection,
): Promise<ContextSelection | undefined> {
  const key = document.uri.toString();
  const metadata = tracker.getMetadata(document);
  const contextNames = new Set(metadata?.contexts ?? []);

  if (contextNames.size === 0) {
    const selection: ContextSelection = {
      defaultContextPath: await getEmptyContextDir(),
      additionalContexts: new Map(),
    };
    contextSelectionCache.set(key, selection);
    return selection;
  }

  const previousSelection = cachedValue ?? contextSelectionCache.get(key);
  const sortedNames = [...contextNames].sort();
  const selections = new Map<string, string>();
  let defaultPath = previousSelection?.defaultContextPath ?? (await getEmptyContextDir());

  for (const name of sortedNames) {
    const promptLabel = name === 'context' ? 'default build context' : `build context "${name}"`;
    const defaultValue =
      name === 'context'
        ? toInputValue(previousSelection?.defaultContextPath)
        : toInputValue(previousSelection?.additionalContexts.get(name));
    const value = await vscode.window.showInputBox({
      prompt: `Enter path for ${promptLabel}`,
      value: defaultValue,
      ignoreFocusOut: true,
    });
    if (value === undefined) {
      return undefined;
    }
    const resolvedPath = resolveContextReference(value.trim() || '.', document);
    if (name === 'context') {
      defaultPath = resolvedPath;
    } else {
      selections.set(name, resolvedPath);
    }
  }

  const selection: ContextSelection = {
    defaultContextPath: defaultPath,
    additionalContexts: selections,
  };
  contextSelectionCache.set(key, selection);
  return selection;
}

export async function getEmptyContextDir(): Promise<string> {
  if (!emptyContextDirReady) {
    emptyContextDirReady = fs
      .mkdir(emptyContextDirPath, { recursive: true })
      .then(() => emptyContextDirPath)
      .catch((error) => {
        void vscode.window.showWarningMessage(`Unable to prepare empty context directory: ${error}`);
        return emptyContextDirPath;
      });
  }
  return emptyContextDirReady;
}

export function toInputValue(value: string | undefined): string {
  return value ?? '.';
}

export async function collectArgsSelection(
  document: vscode.TextDocument,
  tracker: DalecDocumentTracker,
  cachedValue?: ArgsSelection,
): Promise<ArgsSelection | undefined> {
  const metadata = tracker.getMetadata(document);
  const definedArgs = metadata?.args;

  if (!definedArgs || definedArgs.size === 0) {
    const emptySelection: ArgsSelection = { values: new Map() };
    argsSelectionCache.set(document.uri.toString(), emptySelection);
    return emptySelection;
  }

  const key = document.uri.toString();
  const previousSelection = cachedValue ?? argsSelectionCache.get(key);
  const result = new Map<string, string>();

  // Ask if user wants to use customize or default arg values
  const useDefaultsOption = 'Use all default values';
  const customizeOption = 'Customize values';
  const placeHolder = 'Build arguments configuration';
  const selectedOption = await vscode.window.showQuickPick(
    [useDefaultsOption, customizeOption],
    {placeHolder, ignoreFocusOut: true}
  );

  if (selectedOption === undefined) {
    return undefined;
  }

  if (selectedOption === useDefaultsOption) {
    // Use all default or previous values
    for (const [name, defaultValue] of definedArgs.entries()) {
      result.set(name, previousSelection?.values.get(name) ?? defaultValue ?? '');
    }
  } else {
    // Show input boxes for each argument
    for (const [name, defaultValue] of definedArgs.entries()) {
      const value = await vscode.window.showInputBox({
        prompt: `Enter value for build argument "${name}"`,
        value: previousSelection?.values.get(name) ?? defaultValue ?? '',
        placeHolder: defaultValue ?? '',
        ignoreFocusOut: true,
      });
      if (value === undefined) {
        return undefined;
      }
      result.set(name, value);
    }
  }

  const selection: ArgsSelection = { values: result };
  argsSelectionCache.set(key, selection);
  return selection;
}
