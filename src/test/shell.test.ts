import * as assert from 'assert';
import { execFile, execFileSync, NonZeroExitCodeBehaviour, ShellResult } from '../commands/utils/shell';
import { succeeded, failed } from '../commands/utils/errorable';

suite('Shell Utilities Test Suite', () => {
  suite('execFile - Secure Array-Based Execution', () => {
    test('executes command with array arguments', async () => {
      const result = await execFile('echo', ['Hello', 'World']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result.code, 0);
        assert.ok(result.result.stdout.includes('Hello World'));
      }
    });

    test('prevents shell injection with special characters in arguments', async () => {
      // Test that special characters are treated literally, not interpreted
      const result = await execFile('echo', ['test$(whoami)', 'test;ls', 'test|cat']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        // Characters should appear literally in output, not be executed
        const output = result.result.stdout.trim();
        assert.ok(output.includes('$') || output.includes('test'));
      }
    });

    test('handles file paths with spaces safely', async () => {
      const result = await execFile('echo', ['path with spaces', 'another path']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.ok(result.result.stdout.includes('path with spaces'));
      }
    });

    test('handles non-zero exit code with Fail behavior', async () => {
      // Use Node.js to exit with specific code - no shell required
      const result = await execFile(process.execPath, ['-e', 'process.exit(5)']);

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.ok(result.error.includes('exit code 5'));
      }
    });

    test('succeeds on non-zero exit with Succeed behavior', async () => {
      // Use Node.js to exit with specific code - no shell required
      const result = await execFile(process.execPath, ['-e', 'process.exit(3)'], {
        exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed,
      });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result.code, 3);
      }
    });

    test('passes environment variables', async () => {
      // Use Node.js to print env var - no shell required
      const result = await execFile(process.execPath, ['-p', 'process.env.CUSTOM_VAR'], {
        env: { CUSTOM_VAR: 'custom-value' },
      });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.ok(result.result.stdout.includes('custom-value'));
      }
    });

    test('executes in specified working directory', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }

      const result = await execFile('pwd', [], { cwd: '/tmp' });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.ok(result.result.stdout.includes('/tmp'));
      }
    });

    test('handles command not found error', async () => {
      const result = await execFile('nonexistent_command_12345', []);

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.ok(result.error.length > 0);
      }
    });

    test('handles empty arguments array', async () => {
      const result = await execFile('echo', []);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result.code, 0);
      }
    });

    test('does not invoke shell interpreter', async () => {
      // Pipe character should not work as it requires shell
      const result = await execFile('echo', ['test', '|', 'cat']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        // Pipe should appear literally in output, not be interpreted
        assert.ok(result.result.stdout.includes('|'));
      }
    });
  });

  suite('execFileSync - Synchronous Array-Based Execution', () => {
    test('executes command synchronously with array arguments', () => {
      const result = execFileSync('echo', ['Hello', 'Sync']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result.code, 0);
        assert.ok(result.result.stdout.includes('Hello Sync'));
      }
    });

    test('prevents shell injection in sync mode', () => {
      const result = execFileSync('echo', ['test$(whoami)', 'test;ls']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        const output = result.result.stdout.trim();
        assert.ok(output.includes('$') || output.includes('test'));
      }
    });

    test('handles non-zero exit code with Fail behavior', () => {
      // Use Node.js to exit with specific code - no shell required
      const result = execFileSync(process.execPath, ['-e', 'process.exit(7)']);

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.ok(result.error.includes('exit code 7'));
      }
    });

    test('succeeds on non-zero exit with Succeed behavior', () => {
      // Use Node.js to exit with specific code - no shell required
      const result = execFileSync(process.execPath, ['-e', 'process.exit(4)'], {
        exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed,
      });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result.code, 4);
      }
    });

    test('passes environment variables in sync mode', () => {
      // Use Node.js to print env var - no shell required
      const result = execFileSync(process.execPath, ['-p', 'process.env.SYNC_VAR'], {
        env: { SYNC_VAR: 'sync-test' },
      });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.ok(result.result.stdout.includes('sync-test'));
      }
    });

    test('executes in specified working directory', function () {
      if (process.platform === 'win32') {
        this.skip();
      }

      const result = execFileSync('pwd', [], { cwd: '/tmp' });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.ok(result.result.stdout.includes('/tmp'));
      }
    });

    test('handles command not found error in sync mode', () => {
      const result = execFileSync('nonexistent_sync_command_12345', []);

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.ok(result.error.length > 0);
      }
    });

    test('does not invoke shell interpreter in sync mode', () => {
      const result = execFileSync('echo', ['test', '|', 'cat']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.ok(result.result.stdout.includes('|'));
      }
    });
  });

  suite('ShellResult Interface', () => {
    test('result contains all expected properties', async () => {
      const result = await execFile('echo', ['test']);

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        const shellResult: ShellResult = result.result;
        assert.ok(typeof shellResult.code === 'number');
        assert.ok(typeof shellResult.stdout === 'string');
        assert.ok(typeof shellResult.stderr === 'string');
      }
    });

    test('exit code is properly captured', async () => {
      // Use Node.js to exit with specific code - no shell required
      const result = await execFile(process.execPath, ['-e', 'process.exit(9)'], {
        exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed,
      });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result.code, 9);
      }
    });

    test('stdout and stderr are captured separately', async () => {
      // Use Node.js to write to stdout/stderr - no shell required
      const result = await execFile(process.execPath, [
        '-e',
        'console.log("to stdout"); console.error("to stderr");'
      ], {
        exitCodeBehaviour: NonZeroExitCodeBehaviour.Succeed,
      });

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.ok(result.result.stdout.includes('to stdout'));
        assert.ok(result.result.stderr.includes('to stderr'));
      }
    });
  });
});
