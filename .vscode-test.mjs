import { defineConfig } from '@vscode/test-cli';

const useCustomInstallation = Boolean(process.env.VSCODE_PATH);
const skipExtensionDependencies =
  process.env.VSCODE_SKIP_EXTENSION_DEPENDENCIES === '1' || useCustomInstallation;

export default defineConfig({
  files: 'out/test/**/*.test.js',
  version: 'stable',
  ...(useCustomInstallation ? { useInstallation: { fromPath: process.env.VSCODE_PATH } } : {}),
  ...(skipExtensionDependencies ? { skipExtensionDependencies: true } : {}),
  workspaceFolder: '.',
  mocha: {
    ui: 'tdd',
    timeout: 20000
  }
});
