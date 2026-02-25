import * as assert from 'assert';
import { parseTargetsFromOutput, groupTargets, isDebugScope, type BuildTargetInfo } from '../commands/runBuildCurrentSpecCommand/helpers/targetHelpers';

suite('Target Helpers Test Suite', () => {
  suite('parseTargetsFromOutput', () => {
    test('parses simple target list', () => {
      const output = `
TARGET                DESCRIPTION
mariner2/rpm          Build RPM for Mariner 2
mariner2/container    Build container for Mariner 2
azlinux3/rpm          Build RPM for Azure Linux 3
`;
      const targets = parseTargetsFromOutput(output);

      assert.strictEqual(targets.length, 3);
      assert.strictEqual(targets[0].name, 'mariner2/rpm');
      assert.strictEqual(targets[0].description, 'Build RPM for Mariner 2');
      assert.strictEqual(targets[1].name, 'mariner2/container');
      assert.strictEqual(targets[2].name, 'azlinux3/rpm');
    });

    test('parses targets with default marker', () => {
      const output = `
TARGET                DESCRIPTION
mariner2/rpm (default)
azlinux3/rpm          Build RPM
`;
      const targets = parseTargetsFromOutput(output);

      assert.strictEqual(targets.length, 2);
      assert.strictEqual(targets[0].name, 'mariner2/rpm');
      assert.strictEqual(targets[1].name, 'azlinux3/rpm');
      assert.strictEqual(targets[1].description, 'Build RPM');
    });

    test('parses targets without descriptions', () => {
      const output = `
mariner2/rpm
mariner2/container
azlinux3/deb
`;
      const targets = parseTargetsFromOutput(output);

      assert.strictEqual(targets.length, 3);
      assert.strictEqual(targets[0].name, 'mariner2/rpm');
      assert.strictEqual(targets[1].name, 'mariner2/container');
      assert.strictEqual(targets[2].name, 'azlinux3/deb');
      assert.strictEqual(targets[0].description, undefined);
    });

    test('ignores header lines', () => {
      const output = `
TARGET                DESCRIPTION
====================  ====================
mariner2/rpm          Build RPM
--------------------- --------------------
azlinux3/rpm          Build RPM
`;
      const targets = parseTargetsFromOutput(output);

      assert.strictEqual(targets.length, 2);
      assert.strictEqual(targets[0].name, 'mariner2/rpm');
      assert.strictEqual(targets[1].name, 'azlinux3/rpm');
    });

    test('handles empty output', () => {
      const targets = parseTargetsFromOutput('');
      assert.strictEqual(targets.length, 0);
    });

    test('handles output with only whitespace', () => {
      const targets = parseTargetsFromOutput('   \n  \n   ');
      assert.strictEqual(targets.length, 0);
    });
  });

  suite('groupTargets', () => {
    test('groups targets by scope', () => {
      const targets: BuildTargetInfo[] = [
        { name: 'mariner2/rpm' },
        { name: 'mariner2/container' },
        { name: 'azlinux3/rpm' },
        { name: 'azlinux3/deb' },
      ];

      const grouped = groupTargets(targets);

      assert.strictEqual(grouped.size, 2);
      assert.strictEqual(grouped.get('mariner2')?.length, 2);
      assert.strictEqual(grouped.get('azlinux3')?.length, 2);
    });

    test('groups debug targets separately', () => {
      const targets: BuildTargetInfo[] = [
        { name: 'mariner2/rpm' },
        { name: 'debug/shell' },
        { name: 'azlinux3/rpm' },
      ];

      const grouped = groupTargets(targets);

      assert.strictEqual(grouped.size, 3);
      assert.ok(grouped.has('debug'));
      assert.strictEqual(grouped.get('debug')?.length, 1);
    });

    test('handles targets without scope', () => {
      const targets: BuildTargetInfo[] = [
        { name: 'standalone' },
        { name: 'mariner2/rpm' },
      ];

      const grouped = groupTargets(targets);

      assert.strictEqual(grouped.size, 2);
      assert.ok(grouped.has('standalone'));
      assert.ok(grouped.has('mariner2'));
    });
  });

  suite('isDebugScope', () => {
    test('identifies debug scope', () => {
      assert.strictEqual(isDebugScope('debug'), true);
      assert.strictEqual(isDebugScope('Debug'), true);
      assert.strictEqual(isDebugScope('DEBUG'), true);
    });

    test('non-debug scopes return false', () => {
      assert.strictEqual(isDebugScope('mariner2'), false);
      assert.strictEqual(isDebugScope('azlinux3'), false);
      assert.strictEqual(isDebugScope('container'), false);
      assert.strictEqual(isDebugScope('debugger'), false);
    });
  });

  suite('Target Scope Filtering', () => {
    test('filters targets for specific scope with slash', () => {
      const targets: BuildTargetInfo[] = [
        { name: 'mariner2/rpm' },
        { name: 'mariner2/container' },
        { name: 'mariner2' }, // Should be excluded
        { name: 'azlinux3/rpm' },
      ];

      const scopeName = 'mariner2';
      const filtered = targets.filter((targetInfo) => {
        const targetScope = targetInfo.name.split('/')[0];
        return targetScope === scopeName && targetInfo.name.includes('/');
      });

      assert.strictEqual(filtered.length, 2);
      assert.strictEqual(filtered[0].name, 'mariner2/rpm');
      assert.strictEqual(filtered[1].name, 'mariner2/container');
    });

    test('excludes base target name without subtype', () => {
      const targets: BuildTargetInfo[] = [
        { name: 'mariner2' },
        { name: 'mariner2/rpm' },
      ];

      const scopeName = 'mariner2';
      const filtered = targets.filter((targetInfo) => {
        const targetScope = targetInfo.name.split('/')[0];
        return targetScope === scopeName && targetInfo.name.includes('/');
      });

      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].name, 'mariner2/rpm');
    });

    test('returns empty array when no matching scoped targets', () => {
      const targets: BuildTargetInfo[] = [
        { name: 'mariner2' },
        { name: 'azlinux3/rpm' },
      ];

      const scopeName = 'mariner2';
      const filtered = targets.filter((targetInfo) => {
        const targetScope = targetInfo.name.split('/')[0];
        return targetScope === scopeName && targetInfo.name.includes('/');
      });

      assert.strictEqual(filtered.length, 0);
    });
  });
});
