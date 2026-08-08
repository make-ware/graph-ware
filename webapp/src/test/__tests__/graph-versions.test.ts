import { describe, it, expect } from 'vitest';
import {
  GRAPH_SNAPSHOT_FORMAT,
  parseSnapshot,
  serializeGraph,
  snapshotMatches,
  snapshotToImports,
  snapshotToNodes,
  buildInstanceId,
  flattenGraph,
} from '@project/shared';
import {
  assembleResolvedGraph as assemble,
  toPinnedGraph,
  type ResolvedGraphData,
} from '@/lib/graph/resolver';
import {
  makeGraph,
  makeImport,
  makeNode,
  makeVersion,
} from './fixtures/graph-fixtures';

const CHILD = makeGraph({
  id: 'child',
  uid: 'BatterySystem',
  label: 'Battery',
});

const OLD_NODE = makeNode({
  id: 'battery',
  graph: 'child',
  name: 'battery',
  label: 'Battery',
  attributes: [{ name: 'voltage', value: '12', kind: 'power' }],
});

const NEW_NODE = makeNode({
  id: 'battery',
  graph: 'child',
  name: 'battery',
  label: 'Battery (rewired)',
  attributes: [{ name: 'voltage', value: '48', kind: 'power' }],
});

describe('serializeGraph', () => {
  it('keeps the original record ids', () => {
    const snapshot = serializeGraph(CHILD, [OLD_NODE], []);

    // Load-bearing: every instance path — and therefore every edge override on
    // every importing graph — ends in a node id. A snapshot that renumbered
    // them would silently break the parents that pinned it.
    expect(snapshot.nodes.map((node) => node.id)).toEqual(['battery']);
    expect(snapshot.format).toBe(GRAPH_SNAPSHOT_FORMAT);
  });

  it('is byte-identical for the same graph however the records are ordered', () => {
    const a = makeNode({ id: 'aaa', graph: 'child', name: 'zulu' });
    const b = makeNode({ id: 'zzz', graph: 'child', name: 'alpha' });

    expect(JSON.stringify(serializeGraph(CHILD, [a, b], []))).toBe(
      JSON.stringify(serializeGraph(CHILD, [b, a], []))
    );
  });

  it('normalizes empty collections to absent', () => {
    const snapshot = serializeGraph(
      makeGraph({ id: 'child', namespace: '', description: '', tags: [] }),
      [makeNode({ id: 'n', attributes: [], ports: [] })],
      []
    );

    expect(snapshot.graph.namespace).toBeUndefined();
    expect(snapshot.nodes[0].attributes).toBeUndefined();
  });

  it('records an import’s own pin and overrides', () => {
    const snapshot = serializeGraph(
      CHILD,
      [],
      [
        makeImport({
          id: 'imp',
          parent: 'child',
          child: 'grandchild',
          alias: 'cells',
          version: 'v_abc',
          attributeOverrides: { battery: { voltage: '24' } },
        }),
      ]
    );

    expect(snapshot.imports[0].version).toBe('v_abc');
    expect(snapshot.imports[0].attributeOverrides).toEqual({
      battery: { voltage: '24' },
    });
  });
});

describe('snapshotMatches', () => {
  it('is true when nothing has moved', () => {
    const snapshot = serializeGraph(CHILD, [OLD_NODE], []);
    expect(snapshotMatches(snapshot, CHILD, [OLD_NODE], [])).toBe(true);
  });

  it('is false once a node changes', () => {
    const snapshot = serializeGraph(CHILD, [OLD_NODE], []);
    expect(snapshotMatches(snapshot, CHILD, [NEW_NODE], [])).toBe(false);
  });

  it('survives the key reordering a round trip through PocketBase applies', () => {
    // PocketBase stores a JSON field by marshalling it in Go, which sorts map
    // keys alphabetically — so a snapshot read back off a record has a
    // different key order from the one `serializeGraph` produces. Comparing
    // raw `JSON.stringify` output would report every graph as changed, and
    // every publish would mint a version that changed nothing.
    const snapshot = serializeGraph(CHILD, [OLD_NODE], []);
    const stored = sortKeysDeep(snapshot);

    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(snapshot));
    expect(snapshotMatches(stored, CHILD, [OLD_NODE], [])).toBe(true);
  });
});

/** Reorder every object's keys alphabetically, as Go's `json.Marshal` does. */
function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => (left < right ? -1 : 1)
    );
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, sortKeysDeep(entry)])
    ) as T;
  }
  return value;
}

describe('parseSnapshot', () => {
  it('refuses a payload from a newer format rather than half-reading it', () => {
    const snapshot = serializeGraph(CHILD, [OLD_NODE], []);
    expect(
      parseSnapshot({ ...snapshot, format: GRAPH_SNAPSHOT_FORMAT + 1 })
    ).toBeNull();
  });

  it('returns null for junk instead of throwing', () => {
    expect(parseSnapshot({ nope: true })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
});

describe('snapshotToNodes / snapshotToImports', () => {
  it('presents a snapshot as records the engine can flatten', () => {
    const snapshot = serializeGraph(CHILD, [OLD_NODE], []);
    const nodes = snapshotToNodes(snapshot, 'child');

    expect(nodes[0].id).toBe('battery');
    expect(nodes[0].graph).toBe('child');

    const flat = flattenGraph({
      id: 'child',
      uid: CHILD.uid,
      name: CHILD.name,
      label: CHILD.label,
      nodes,
      children: [],
    });
    expect(flat[0].instanceId).toBe('battery');
  });

  it('re-parents a snapshot’s imports onto the graph being rendered', () => {
    const snapshot = serializeGraph(
      CHILD,
      [],
      [makeImport({ parent: 'child', child: 'grandchild', alias: 'cells' })]
    );

    expect(snapshotToImports(snapshot, 'child')[0].parent).toBe('child');
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** A root importing `child` twice — one pinned to v1, one live. */
function pinnedBundle(): ResolvedGraphData {
  const root = makeGraph({ id: 'root', uid: 'Boat', label: 'Boat' });
  const version = makeVersion(CHILD, [OLD_NODE], [], { id: 'v1', version: 1 });

  const pin = toPinnedGraph(version);
  expect(pin).not.toBeNull();

  return {
    graphs: new Map([
      ['root', root],
      ['child', CHILD],
    ]),
    // The *live* child has moved on since v1 was taken.
    nodesByGraph: new Map([
      ['root', []],
      ['child', [NEW_NODE]],
    ]),
    importsByParent: new Map([
      [
        'root',
        [
          makeImport({
            id: 'imp_pinned',
            parent: 'root',
            child: 'child',
            alias: 'frozen',
            order: 0,
            version: 'v1',
          }),
          makeImport({
            id: 'imp_live',
            parent: 'root',
            child: 'child',
            alias: 'current',
            order: 1,
          }),
        ],
      ],
    ]),
    pins: new Map([['v1', pin!]]),
  };
}

describe('assembleResolvedGraph — pinned imports', () => {
  it('renders the snapshot for a pinned import and the record for a live one', () => {
    const { graph, diagnostics } = assemble('root', pinnedBundle());

    expect(diagnostics).toEqual([]);

    const [frozen, current] = graph!.children;
    expect(frozen.alias).toBe('frozen');
    expect(frozen.versionNumber).toBe(1);
    expect(frozen.graph.nodes[0].label).toBe('Battery');

    expect(current.alias).toBe('current');
    expect(current.versionNumber).toBeUndefined();
    expect(current.graph.nodes[0].label).toBe('Battery (rewired)');
  });

  it('keeps the node id stable across the pin, so overrides still address it', () => {
    const { graph } = assemble('root', pinnedBundle());
    const nodes = flattenGraph(graph!);

    expect(nodes.map((node) => node.instanceId).sort()).toEqual(
      [
        buildInstanceId(['current'], 'battery'),
        buildInstanceId(['frozen'], 'battery'),
      ].sort()
    );
  });

  it('falls back to live and says so when the pinned version cannot be read', () => {
    const data = pinnedBundle();
    data.pins.delete('v1');

    const { graph, diagnostics } = assemble('root', data);

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      'version-unreadable',
    ]);
    // Falling back, not dropping the subtree: a wrong picture the user can see
    // beats an empty branch they cannot explain.
    expect(graph!.children[0].graph.nodes[0].label).toBe('Battery (rewired)');
  });
});
