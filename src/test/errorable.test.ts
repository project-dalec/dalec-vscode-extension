import * as assert from 'assert';
import {
  Errorable,
  succeeded,
  failed,
  success,
  map,
  bind,
  bindAsync,
  bindAll,
  bindAllAsync,
  applyAll,
  applyAllAsync,
  combine,
  getErrorMessage,
  findOrError,
} from '../commands/utils/errorable';

suite('Errorable Pattern Test Suite', () => {
  suite('Type Guards', () => {
    test('succeeded returns true for successful result', () => {
      const result: Errorable<number> = { succeeded: true, result: 42 };
      assert.strictEqual(succeeded(result), true);
      assert.strictEqual(failed(result), false);
    });

    test('failed returns true for failed result', () => {
      const result: Errorable<number> = { succeeded: false, error: 'Something went wrong' };
      assert.strictEqual(failed(result), true);
      assert.strictEqual(succeeded(result), false);
    });
  });

  suite('success Constructor', () => {
    test('creates successful Errorable with value', () => {
      const result = success(42);
      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result, 42);
      }
    });

    test('handles different types', () => {
      const stringResult = success('hello');
      const arrayResult = success([1, 2, 3]);
      const objectResult = success({ key: 'value' });

      assert.strictEqual(succeeded(stringResult), true);
      assert.strictEqual(succeeded(arrayResult), true);
      assert.strictEqual(succeeded(objectResult), true);
    });
  });

  suite('map Function', () => {
    test('transforms successful value', () => {
      const input: Errorable<number> = { succeeded: true, result: 5 };
      const output = map(input, (n: number) => n * 2);

      assert.strictEqual(succeeded(output), true);
      if (succeeded(output)) {
        assert.strictEqual(output.result, 10);
      }
    });

    test('preserves error without applying transformation', () => {
      const input: Errorable<number> = { succeeded: false, error: 'Error message' };
      const output = map(input, (n: number) => n * 2);

      assert.strictEqual(failed(output), true);
      if (failed(output)) {
        assert.strictEqual(output.error, 'Error message');
      }
    });

    test('changes result type', () => {
      const input: Errorable<number> = { succeeded: true, result: 42 };
      const output = map(input, (n) => n.toString());

      assert.strictEqual(succeeded(output), true);
      if (succeeded(output)) {
        assert.strictEqual(output.result, '42');
      }
    });
  });

  suite('bind Function', () => {
    test('chains successful operations', () => {
      const input: Errorable<number> = { succeeded: true, result: 5 };
      const output = bind(input, (n: number) => success(n * 2));

      assert.strictEqual(succeeded(output), true);
      if (succeeded(output)) {
        assert.strictEqual(output.result, 10);
      }
    });

    test('short-circuits on first error', () => {
      const input: Errorable<number> = { succeeded: false, error: 'Initial error' };
      const output = bind(input, (n: number) => success(n * 2));

      assert.strictEqual(failed(output), true);
      if (failed(output)) {
        assert.strictEqual(output.error, 'Initial error');
      }
    });

    test('propagates error from bound function', () => {
      const input: Errorable<number> = { succeeded: true, result: 5 };
      const output = bind(input, () => ({ succeeded: false, error: 'Bound error' }));

      assert.strictEqual(failed(output), true);
      if (failed(output)) {
        assert.strictEqual(output.error, 'Bound error');
      }
    });
  });

  suite('bindAsync Function', () => {
    test('chains async successful operations', async () => {
      const input: Errorable<number> = { succeeded: true, result: 5 };
      const output = await bindAsync(input, async (n: number) => success(n * 2));

      assert.strictEqual(succeeded(output), true);
      if (succeeded(output)) {
        assert.strictEqual(output.result, 10);
      }
    });

    test('short-circuits on error without calling async function', async () => {
      const input: Errorable<number> = { succeeded: false, error: 'Initial error' };
      let called = false;
      const output = await bindAsync(input, async (n: number) => {
        called = true;
        return success(n * 2);
      });

      assert.strictEqual(failed(output), true);
      assert.strictEqual(called, false);
      if (failed(output)) {
        assert.strictEqual(output.error, 'Initial error');
      }
    });
  });

  suite('combine Function', () => {
    test('combines multiple successful results', () => {
      const results: Errorable<number>[] = [
        { succeeded: true, result: 1 },
        { succeeded: true, result: 2 },
        { succeeded: true, result: 3 },
      ];

      const combined = combine(results);
      assert.strictEqual(succeeded(combined), true);
      if (succeeded(combined)) {
        assert.deepStrictEqual(combined.result, [1, 2, 3]);
      }
    });

    test('fails if any result fails', () => {
      const results: Errorable<number>[] = [
        { succeeded: true, result: 1 },
        { succeeded: false, error: 'Error 1' },
        { succeeded: true, result: 3 },
      ];

      const combined = combine(results);
      assert.strictEqual(failed(combined), true);
      if (failed(combined)) {
        assert.strictEqual(combined.error, 'Error 1');
      }
    });

    test('combines multiple errors with newlines', () => {
      const results: Errorable<number>[] = [
        { succeeded: false, error: 'Error 1' },
        { succeeded: false, error: 'Error 2' },
        { succeeded: false, error: 'Error 3' },
      ];

      const combined = combine(results);
      assert.strictEqual(failed(combined), true);
      if (failed(combined)) {
        assert.strictEqual(combined.error, 'Error 1\nError 2\nError 3');
      }
    });

    test('handles empty array', () => {
      const results: Errorable<number>[] = [];
      const combined = combine(results);

      assert.strictEqual(succeeded(combined), true);
      if (succeeded(combined)) {
        assert.deepStrictEqual(combined.result, []);
      }
    });
  });

  suite('applyAll Function', () => {
    test('applies function to all items successfully', () => {
      const items = [1, 2, 3];
      const result = applyAll(items, (n) => success(n * 2));

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.deepStrictEqual(result.result, [2, 4, 6]);
      }
    });

    test('fails if any application fails', () => {
      const items = [1, 2, 3];
      const result = applyAll(items, (n) => (n === 2 ? { succeeded: false, error: 'Failed at 2' } : success(n)));

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.strictEqual(result.error, 'Failed at 2');
      }
    });
  });

  suite('applyAllAsync Function', () => {
    test('applies async function to all items successfully', async () => {
      const items = [1, 2, 3];
      const result = await applyAllAsync(items, async (n) => success(n * 2));

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.deepStrictEqual(result.result, [2, 4, 6]);
      }
    });

    test('fails if any async application fails', async () => {
      const items = [1, 2, 3];
      const result = await applyAllAsync(items, async (n) =>
        n === 2 ? { succeeded: false, error: 'Async failed at 2' } : success(n),
      );

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.strictEqual(result.error, 'Async failed at 2');
      }
    });
  });

  suite('bindAll Function', () => {
    test('applies function to array result successfully', () => {
      const input: Errorable<number[]> = { succeeded: true, result: [1, 2, 3] };
      const output = bindAll(input, (n: number) => success(n * 2));

      assert.strictEqual(succeeded(output), true);
      if (succeeded(output)) {
        assert.deepStrictEqual(output.result, [2, 4, 6]);
      }
    });

    test('short-circuits if input is failed', () => {
      const input: Errorable<number[]> = { succeeded: false, error: 'Input error' };
      const output = bindAll(input, (n: number) => success(n * 2));

      assert.strictEqual(failed(output), true);
      if (failed(output)) {
        assert.strictEqual(output.error, 'Input error');
      }
    });
  });

  suite('bindAllAsync Function', () => {
    test('applies async function to array result successfully', async () => {
      const input: Errorable<number[]> = { succeeded: true, result: [1, 2, 3] };
      const output = await bindAllAsync(input, async (n: number) => success(n * 2));

      assert.strictEqual(succeeded(output), true);
      if (succeeded(output)) {
        assert.deepStrictEqual(output.result, [2, 4, 6]);
      }
    });

    test('short-circuits if input is failed', async () => {
      const input: Errorable<number[]> = { succeeded: false, error: 'Input error' };
      let called = false;
      const output = await bindAllAsync(input, async (n: number) => {
        called = true;
        return success(n * 2);
      });

      assert.strictEqual(failed(output), true);
      assert.strictEqual(called, false);
      if (failed(output)) {
        assert.strictEqual(output.error, 'Input error');
      }
    });
  });

  suite('getErrorMessage Function', () => {
    test('extracts message from Error object', () => {
      const error = new Error('Test error message');
      assert.strictEqual(getErrorMessage(error), 'Test error message');
    });

    test('converts string to string', () => {
      assert.strictEqual(getErrorMessage('String error'), 'String error');
    });

    test('converts number to string', () => {
      assert.strictEqual(getErrorMessage(42), '42');
    });

    test('converts object to string', () => {
      const obj = { key: 'value' };
      assert.strictEqual(getErrorMessage(obj), '[object Object]');
    });

    test('handles null and undefined', () => {
      assert.strictEqual(getErrorMessage(null), 'null');
      assert.strictEqual(getErrorMessage(undefined), 'undefined');
    });
  });

  suite('findOrError Function', () => {
    test('returns found item when predicate matches', () => {
      const items = [1, 2, 3, 4, 5];
      const result = findOrError(items, (n) => n === 3, 'Not found');

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result, 3);
      }
    });

    test('returns error when no item matches predicate', () => {
      const items = [1, 2, 3, 4, 5];
      const result = findOrError(items, (n) => n === 10, 'Item not found');

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.strictEqual(result.error, 'Item not found');
      }
    });

    test('returns first matching item', () => {
      const items = [1, 2, 3, 2, 1];
      const result = findOrError(items, (n) => n === 2, 'Not found');

      assert.strictEqual(succeeded(result), true);
      if (succeeded(result)) {
        assert.strictEqual(result.result, 2);
      }
    });

    test('handles empty array', () => {
      const items: number[] = [];
      const result = findOrError(items, () => true, 'Empty array');

      assert.strictEqual(failed(result), true);
      if (failed(result)) {
        assert.strictEqual(result.error, 'Empty array');
      }
    });
  });
});
