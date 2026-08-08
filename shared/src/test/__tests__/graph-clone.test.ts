import { describe, it, expect } from 'vitest';
import type { ImportEdge } from '../../index';
import {
  cloneDepth,
  forkedUid,
  partitionImports,
  planClone,
} from '../../lib/graph/clone';
import { makeImport } from '../fixtures/graph-fixtures';

/** The seeded tree: `testDataElement` imports `BatterySystem` twice. */
const SAMPLE_EDGES: ImportEdge[] = [
  { parent: 'testDataElement', child: 'BatterySystem' },
  { parent: 'testDataElement', child: 'BatterySystem' },
  { parent: 'testDataElement', child: 'EngineSystem' },
];

const SAMPLE_IMPORTS = [
  makeImport({
    parent: 'testDataElement',
    child: 'BatterySystem',
    alias: 'port_bank',
    order: 0,
  }),
  makeImport({
    parent: 'testDataElement',
    child: 'BatterySystem',
    alias: 'starboard_bank',
    order: 1,
  }),
  makeImport({
    parent: 'testDataElement',
    child: 'EngineSystem',
    alias: 'control',
    order: 2,
  }),
];

describe('planClone', () => {
  it('copies only the root for a shallow fork', () => {
    const plan = planClone('testDataElement', SAMPLE_EDGES);
    expect(plan.sources).toEqual(['testDataElement']);
  });

  it('copies a twice-imported child exactly once', () => {
    const plan = planClone('testDataElement', SAMPLE_EDGES, { deep: true });

    // The acceptance case: `BatterySystem` appears under two aliases and must
    // become *one* copy, or the two instances stop being the same component the
    // moment either is edited.
    expect(plan.sources).toEqual([
      'testDataElement',
      'BatterySystem',
      'EngineSystem',
    ]);
    expect(plan.copied.size).toBe(3);
  });

  it('reaches a grandchild', () => {
    const edges: ImportEdge[] = [
      ...SAMPLE_EDGES,
      { parent: 'BatterySystem', child: 'CellPack' },
    ];

    expect(
      planClone('testDataElement', edges, { deep: true }).copied
    ).toContain('CellPack');
  });

  it('puts the root first whatever the ids sort like', () => {
    const edges: ImportEdge[] = [{ parent: 'zzz', child: 'aaa' }];
    expect(planClone('zzz', edges, { deep: true }).sources[0]).toBe('zzz');
  });

  it('terminates on a cycle in malformed data', () => {
    const edges: ImportEdge[] = [
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'a' },
    ];

    expect(planClone('a', edges, { deep: true }).copied).toEqual(
      new Set(['a', 'b'])
    );
  });
});

describe('partitionImports', () => {
  it('rewires every import when the whole subtree is copied', () => {
    const { copied } = planClone('testDataElement', SAMPLE_EDGES, {
      deep: true,
    });
    const { internal, external } = partitionImports(copied, SAMPLE_IMPORTS);

    // Both `BatterySystem` instances are rewired — to the same copy.
    expect(internal.map((row) => row.alias)).toEqual([
      'port_bank',
      'starboard_bank',
      'control',
    ]);
    expect(external).toEqual([]);
  });

  it('leaves every import pointing at the original for a shallow fork', () => {
    const { copied } = planClone('testDataElement', SAMPLE_EDGES);
    const { internal, external } = partitionImports(copied, SAMPLE_IMPORTS);

    expect(internal).toEqual([]);
    expect(external).toHaveLength(3);
    // The aliases survive, which is what keeps the copy's edge overrides
    // addressing the same instance paths.
    expect(external.map((row) => row.alias)).toEqual([
      'port_bank',
      'starboard_bank',
      'control',
    ]);
  });

  it('ignores imports declared by graphs outside the fork', () => {
    const stranger = makeImport({ parent: 'somebody_else', child: 'x' });
    const { copied } = planClone('testDataElement', SAMPLE_EDGES);

    const { internal, external } = partitionImports(copied, [stranger]);
    expect(internal).toEqual([]);
    expect(external).toEqual([]);
  });
});

describe('cloneDepth', () => {
  it('counts graphs including the root', () => {
    expect(cloneDepth('testDataElement', SAMPLE_EDGES)).toBe(2);
    expect(cloneDepth('BatterySystem', SAMPLE_EDGES)).toBe(1);
  });

  it('measures the longest branch, not the first', () => {
    const edges: ImportEdge[] = [
      { parent: 'a', child: 'shallow' },
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'c' },
      { parent: 'c', child: 'd' },
    ];

    expect(cloneDepth('a', edges)).toBe(4);
  });

  it('returns a finite number for a cycle in malformed data', () => {
    const edges: ImportEdge[] = [
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'a' },
    ];

    expect(cloneDepth('a', edges)).toBe(2);
  });
});

describe('forkedUid', () => {
  it('appends -copy', () => {
    expect(forkedUid('BatterySystem', [])).toBe('BatterySystem-copy');
  });

  it('numbers subsequent copies', () => {
    expect(forkedUid('BatterySystem', ['BatterySystem-copy'])).toBe(
      'BatterySystem-copy-2'
    );
    expect(
      forkedUid('BatterySystem', ['BatterySystem-copy', 'BatterySystem-copy-2'])
    ).toBe('BatterySystem-copy-3');
  });

  it('stays inside the 64-character uid limit', () => {
    const long = 'x'.repeat(64);
    expect(forkedUid(long, []).length).toBeLessThanOrEqual(64);
    expect(forkedUid(long, [forkedUid(long, [])]).length).toBeLessThanOrEqual(
      64
    );
  });
});
