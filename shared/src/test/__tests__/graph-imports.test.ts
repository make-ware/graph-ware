import { describe, it, expect } from 'vitest';
import {
  buildInstanceId,
  parseInstanceId,
  formatInstancePath,
  checkImport,
  wouldCreateCycle,
  collectAncestors,
  collectDescendants,
  nextAvailableAlias,
  isValidAlias,
  isUnderAlias,
  rewriteAliasPrefix,
  MAX_IMPORT_DEPTH,
  type ImportEdge,
} from '@project/shared';

// The seeded shape: one root importing BatterySystem twice and EngineSystem once.
const SEEDED: ImportEdge[] = [
  { parent: 'root', child: 'battery' },
  { parent: 'root', child: 'battery' },
  { parent: 'root', child: 'engine' },
];

/** A straight chain of `length` graphs: g0 -> g1 -> ... */
function chain(length: number): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (let i = 0; i < length - 1; i++) {
    edges.push({ parent: `g${i}`, child: `g${i + 1}` });
  }
  return edges;
}

describe('buildInstanceId', () => {
  it('is the bare node id at the root', () => {
    expect(buildInstanceId([], 'abc')).toBe('abc');
  });

  it('prefixes the alias chain', () => {
    expect(buildInstanceId(['port_bank'], 'abc')).toBe('port_bank/abc');
    expect(buildInstanceId(['port_bank', 'cells'], 'abc')).toBe(
      'port_bank/cells/abc'
    );
  });

  it('distinguishes the same node under two imports of one child', () => {
    const port = buildInstanceId(['port_bank'], 'house_battery_1');
    const starboard = buildInstanceId(['starboard_bank'], 'house_battery_1');

    expect(port).not.toBe(starboard);
  });

  it('round-trips through parseInstanceId', () => {
    const id = buildInstanceId(['port_bank', 'cells'], 'abc');
    expect(parseInstanceId(id)).toEqual({
      path: ['port_bank', 'cells'],
      nodeId: 'abc',
    });
    expect(parseInstanceId('abc')).toEqual({ path: [], nodeId: 'abc' });
  });
});

describe('formatInstancePath', () => {
  it('names the empty path', () => {
    expect(formatInstancePath([])).toBe('root');
    expect(formatInstancePath(['port_bank', 'cells'])).toBe(
      'port_bank › cells'
    );
  });
});

describe('traversal', () => {
  const edges: ImportEdge[] = [
    { parent: 'a', child: 'b' },
    { parent: 'b', child: 'c' },
    { parent: 'x', child: 'c' },
  ];

  it('collects transitive descendants', () => {
    expect(collectDescendants('a', edges)).toEqual(new Set(['b', 'c']));
    expect(collectDescendants('c', edges)).toEqual(new Set());
  });

  it('collects transitive ancestors, including a second branch', () => {
    expect(collectAncestors('c', edges)).toEqual(new Set(['b', 'a', 'x']));
  });
});

describe('checkImport', () => {
  it('refuses a graph importing itself', () => {
    const result = checkImport('root', 'root', SEEDED);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('self');
  });

  it('refuses a direct cycle', () => {
    const result = checkImport('battery', 'root', SEEDED);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('cycle');
  });

  it('refuses a transitive cycle', () => {
    const edges: ImportEdge[] = [
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'c' },
    ];
    const result = checkImport('c', 'a', edges);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('cycle');
  });

  it('allows a diamond — that is the reuse, not a cycle', () => {
    expect(checkImport('engine', 'battery', SEEDED).ok).toBe(true);
  });

  it('allows importing the same child a second time', () => {
    expect(checkImport('root', 'battery', SEEDED).ok).toBe(true);
  });

  it('allows a chain exactly at the depth limit', () => {
    // MAX_IMPORT_DEPTH - 1 graphs already linked; adding one more reaches the limit.
    const edges = chain(MAX_IMPORT_DEPTH - 1);
    const result = checkImport(
      `g${MAX_IMPORT_DEPTH - 2}`,
      `g${MAX_IMPORT_DEPTH - 1}`,
      edges
    );
    expect(result.ok).toBe(true);
  });

  it('refuses the link that would exceed the depth limit', () => {
    const edges = chain(MAX_IMPORT_DEPTH);
    const result = checkImport(
      `g${MAX_IMPORT_DEPTH - 1}`,
      `g${MAX_IMPORT_DEPTH}`,
      edges
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('depth');
    expect(
      result.ok === false && result.reason === 'depth' && result.depth
    ).toBe(MAX_IMPORT_DEPTH + 1);
  });

  it('counts depth through both sides of the new link', () => {
    // Two chains of four, joined in the middle, would be eight graphs deep — legal —
    // but joining two chains of five makes ten.
    const above = chain(5).map((edge) => ({
      parent: `up_${edge.parent}`,
      child: `up_${edge.child}`,
    }));
    const below = chain(5).map((edge) => ({
      parent: `down_${edge.parent}`,
      child: `down_${edge.child}`,
    }));

    const result = checkImport('up_g4', 'down_g0', [...above, ...below]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('depth');
  });

  it('terminates on a database that already contains a cycle', () => {
    const edges: ImportEdge[] = [
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'a' },
    ];
    expect(() => checkImport('a', 'c', edges)).not.toThrow();
  });
});

describe('wouldCreateCycle', () => {
  it('is true for self and cycles, false for depth and legal imports', () => {
    expect(wouldCreateCycle('root', 'root', SEEDED)).toBe(true);
    expect(wouldCreateCycle('battery', 'root', SEEDED)).toBe(true);
    expect(wouldCreateCycle('engine', 'battery', SEEDED)).toBe(false);

    const edges = chain(MAX_IMPORT_DEPTH);
    expect(
      wouldCreateCycle(
        `g${MAX_IMPORT_DEPTH - 1}`,
        `g${MAX_IMPORT_DEPTH}`,
        edges
      )
    ).toBe(false);
  });
});

describe('nextAvailableAlias', () => {
  it('returns the base when it is free', () => {
    expect(nextAvailableAlias('battery_system', [])).toBe('battery_system');
  });

  it('suffixes past every taken alias', () => {
    expect(nextAvailableAlias('battery_system', ['battery_system'])).toBe(
      'battery_system_2'
    );
    expect(
      nextAvailableAlias('battery_system', [
        'battery_system',
        'battery_system_2',
      ])
    ).toBe('battery_system_3');
  });

  it('produces aliases that satisfy the alias pattern', () => {
    const alias = nextAvailableAlias('battery_system', ['battery_system']);
    expect(isValidAlias(alias)).toBe(true);
  });
});

// Renaming an alias invalidates every override beneath it, because the alias is
// stored verbatim inside `sourcePath` / `targetPath`. The editor rewrites those
// paths in the same operation — see docs/IMPORTS.md § Renaming an alias.
describe('isUnderAlias', () => {
  it('matches an instance directly under the alias', () => {
    expect(isUnderAlias('port_bank/abc', 'port_bank')).toBe(true);
  });

  it('matches an instance nested deeper', () => {
    expect(isUnderAlias('port_bank/cells/abc', 'port_bank')).toBe(true);
  });

  it('does not match a root-graph node', () => {
    expect(isUnderAlias('abc', 'port_bank')).toBe(false);
  });

  it('does not match an alias that merely shares a prefix', () => {
    // The separator is what stops `port_bank` swallowing `port_bank_2`.
    expect(isUnderAlias('port_bank_2/abc', 'port_bank')).toBe(false);
  });

  it('does not match the alias on its own', () => {
    expect(isUnderAlias('port_bank', 'port_bank')).toBe(false);
  });
});

describe('rewriteAliasPrefix', () => {
  it('re-points an instance under the renamed alias', () => {
    expect(rewriteAliasPrefix('port_bank/abc', 'port_bank', 'harbour')).toBe(
      'harbour/abc'
    );
  });

  it('rewrites only the leading segment of a nested path', () => {
    expect(
      rewriteAliasPrefix('port_bank/cells/abc', 'port_bank', 'harbour')
    ).toBe('harbour/cells/abc');
  });

  it('leaves other imports and root nodes untouched', () => {
    expect(
      rewriteAliasPrefix('starboard_bank/abc', 'port_bank', 'harbour')
    ).toBe('starboard_bank/abc');
    expect(rewriteAliasPrefix('abc', 'port_bank', 'harbour')).toBe('abc');
  });

  it('does not rewrite an alias that merely shares a prefix', () => {
    expect(rewriteAliasPrefix('port_bank_2/abc', 'port_bank', 'harbour')).toBe(
      'port_bank_2/abc'
    );
  });

  it('keeps the result addressable by the same node id', () => {
    const before = buildInstanceId(['port_bank', 'cells'], 'abc');
    const after = rewriteAliasPrefix(before, 'port_bank', 'harbour');

    expect(parseInstanceId(after)).toEqual({
      path: ['harbour', 'cells'],
      nodeId: 'abc',
    });
  });
});
