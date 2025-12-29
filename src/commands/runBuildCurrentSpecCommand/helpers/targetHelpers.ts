import * as vscode from 'vscode';
import { DalecDocumentTracker } from '../dalecDocumentTracker';
import { getSpecWorkspacePath } from '../utils/pathHelpers';
import { getDockerErrorMessage } from '../utils/dockerHelpers';
import { execFile } from '../../utils/shell';
import { failed } from '../../utils/errorable';

const FRONTEND_TARGET_CACHE_TTL_MS = 5 * 60 * 1000;
const frontendTargetCache = new Map<string, FrontendTargetCacheEntry>();

export interface BuildTargetInfo {
  name: string;
  description?: string;
}

interface FrontendTargetCacheEntry {
  targets: BuildTargetInfo[];
  timestamp: number;
}

export async function pickTarget(
  document: vscode.TextDocument,
  tracker: DalecDocumentTracker,
  placeholder: string,
): Promise<string | undefined> {
  const targets = await getTargetsForDocument(document, tracker);

  if (targets.length === 0) {
    const manual = await vscode.window.showInputBox({
      prompt: 'No targets detected in this spec. Enter a target name to use.',
      placeHolder: 'target-name',
    });
    return manual?.trim() || undefined;
  }

  if (targets.length === 1) {
    return targets[0].name;
  }

  const scoped = groupTargets(targets);
  const scopes = [...scoped.keys()].sort((a, b) => {
    const aDebug = isDebugScope(a);
    const bDebug = isDebugScope(b);
    if (aDebug && !bDebug) {
      return 1;
    }
    if (!aDebug && bDebug) {
      return -1;
    }
    return a.localeCompare(b);
  });

  const scopeChoice = await vscode.window.showQuickPick(scopes, {
    placeHolder: 'Select target group',
  });
  if (!scopeChoice) {
    return undefined;
  }

  const scopeTargets = scoped.get(scopeChoice)!;
  scopeTargets.sort((a, b) => a.name.localeCompare(b.name));
  const targetChoice = await vscode.window.showQuickPick(
    scopeTargets.map((targetInfo) => ({
      label: targetInfo.name.slice(targetInfo.name.indexOf('/') + 1) || targetInfo.name,
      detail: targetInfo.description,
      target: targetInfo.name,
    })),
    {
      placeHolder: placeholder,
      matchOnDetail: true,
    },
  );

  return targetChoice?.target;
}

export async function getTargetsForDocument(
  document: vscode.TextDocument,
  tracker: DalecDocumentTracker,
): Promise<BuildTargetInfo[]> {
  const merged = new Map<string, BuildTargetInfo>();
  const trackedTargets = tracker.getMetadata(document)?.targets ?? [];
  for (const name of trackedTargets) {
    if (!merged.has(name)) {
      merged.set(name, { name });
    }
  }

  const frontendTargets = await getFrontendTargets(document);
  frontendTargets?.forEach((info) => merged.set(info.name, info));

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFrontendTargets(document: vscode.TextDocument): Promise<BuildTargetInfo[] | undefined> {
  const key = document.uri.toString();
  const now = Date.now();
  const cached = frontendTargetCache.get(key);
  if (cached && now - cached.timestamp < FRONTEND_TARGET_CACHE_TTL_MS) {
    return cached.targets;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Querying Dalec targets via docker buildx...',
      cancellable: false,
    },
    async () => {
      try {
        const contextPath = getSpecWorkspacePath(document);
        const args = ['buildx', 'build', '--call', 'targets', '-f', document.uri.fsPath, contextPath];
        
        const shellResult = await execFile('docker', args, {
          cwd: contextPath,
          env: {
            ...process.env,
            BUILDX_EXPERIMENTAL: '1',
          },
        });

        if (failed(shellResult)) {
          const errorMessage = getDockerErrorMessage(shellResult.error);
          void vscode.window.showWarningMessage(errorMessage, 'View Documentation').then((selection) => {
            if (selection === 'View Documentation') {
              vscode.env.openExternal(vscode.Uri.parse('https://docs.docker.com/get-docker/'));
            }
          });
          return cached?.targets;
        }

        const parsed = parseTargetsFromOutput(shellResult.result.stdout);
        if (parsed.length > 0) {
          frontendTargetCache.set(key, { targets: parsed, timestamp: Date.now() });
        }
        return parsed;
      } catch (error) {
        const errorMessage = getDockerErrorMessage(error);
        void vscode.window.showWarningMessage(errorMessage, 'View Documentation').then((selection) => {
          if (selection === 'View Documentation') {
            vscode.env.openExternal(vscode.Uri.parse('https://docs.docker.com/get-docker/'));
          }
        });
        return cached?.targets;
      }
    },
  );
}

export function parseTargetsFromOutput(output: string): BuildTargetInfo[] {
  const targets: BuildTargetInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^target/i.test(trimmed) || trimmed.startsWith('=') || trimmed.startsWith('-')) {
      continue;
    }

    const match =
      trimmed.match(/^([A-Za-z0-9._/-]+)(?:\s+\(default\))?(?:\s{2,}(.*))?$/) ??
      trimmed.match(/^([A-Za-z0-9._/-]+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const name = match[1];
    const description = match[2]?.trim() || undefined;
    targets.push({ name, description });
  }
  return targets;
}

export function groupTargets(targets: BuildTargetInfo[]): Map<string, BuildTargetInfo[]> {
  const grouped = new Map<string, BuildTargetInfo[]>();
  for (const info of targets) {
    const scope = info.name.split('/')[0] || info.name;
    if (!grouped.has(scope)) {
      grouped.set(scope, []);
    }
    grouped.get(scope)!.push(info);
  }
  return grouped;
}

export function isDebugScope(value: string): boolean {
  return value.toLowerCase() === 'debug';
}
