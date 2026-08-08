import { describe, it, expect } from 'vitest';
import { MAX_IMPORT_DEPTH, type ResolvedGraph } from '../../index';
import {
  assembleResolvedGraph,
  loadImportTree,
  resolveGraph,
  type ResolvedGraphData,
} from '../../lib/graph/resolver';
import type { TypedPocketBase } from '../../types';
import {
  SAMPLES,
  makeGraph,
  makeImport,
  makeNode,
  sampleBundle,
} from '../fixtures/graph-fixtures';

const ROOT = SAMPLES.testDataElement.id;

const codes = (diagnostics: { code: string }[]) =>
  diagnostics.map((diagnostic) => diagnostic.code);

/** How many graphs deep the longest chain of the resolved tree runs. */
function depthOf(graph: ResolvedGraph): number {
  return (
    1 + Math.max(0, ...graph.children.map((child) => depthOf(child.graph)))
  );
}

/** A straight chain of `length` graphs, one node each. */
function chainBundle(length: number): ResolvedGraphData {
  const graphs = new Map();
  const nodesByGraph = new Map();
  const importsByParent = new Map();

  for (let index = 0; index < length; index++) {
    const id = `g${index}`;
    graphs.set(id, makeGraph({ id, label: `Graph ${index}` }));
    nodesByGraph.set(id, [
      makeNode({ id: `n${index}`, graph: id, name: `n${index}` }),
    ]);
    if (index > 0) {
      importsByParent.set(`g${index - 1}`, [
        makeImport({
          parent: `g${index - 1}`,
          child: id,
          alias: `child_${index}`,
        }),
      ]);
    }
  }

  return { graphs, nodesByGraph, importsByParent, pins: new Map() };
}

describe('assembleResolvedGraph — the sample tree', () => {
  it('resolves three children, two of them the same graph', () => {
    const { graph, diagnostics } = assembleResolvedGraph(ROOT, sampleBundle());

    expect(diagnostics).toHaveLength(0);
    expect(graph!.children.map((child) => child.alias)).toEqual([
      'port_bank',
      'starboard_bank',
      'control',
    ]);
    expect(graph!.children[0].graph.id).toBe(graph!.children[1].graph.id);
    // …but not the same object, so a truncation under one alias cannot leak
    // into the other.
    expect(graph!.children[0].graph).not.toBe(graph!.children[1].graph);
  });

  it('orders children by `order`, then alias', () => {
    const data = sampleBundle();
    const imports = data.importsByParent.get(ROOT)!;
    data.importsByParent.set(ROOT, [...imports].reverse());

    const { graph } = assembleResolvedGraph(ROOT, data);
    expect(graph!.children.map((child) => child.alias)).toEqual([
      'port_bank',
      'starboard_bank',
      'control',
    ]);
  });

  it('reports a graph it could not read at all', () => {
    const { graph, diagnostics } = assembleResolvedGraph('nobody', {
      graphs: new Map(),
      nodesByGraph: new Map(),
      importsByParent: new Map(),
      pins: new Map(),
    });

    expect(graph).toBeNull();
    expect(codes(diagnostics)).toEqual(['child-unreadable']);
    expect(diagnostics[0].level).toBe('error');
  });
});

describe('assembleResolvedGraph — disabled imports', () => {
  it('omits the subtree and says so', () => {
    const data = sampleBundle();
    const imports = data.importsByParent.get(ROOT)!;
    data.importsByParent.set(ROOT, [
      { ...imports[0], enabled: false },
      ...imports.slice(1),
    ]);

    const { graph, diagnostics } = assembleResolvedGraph(ROOT, data);

    expect(graph!.children.map((child) => child.alias)).toEqual([
      'starboard_bank',
      'control',
    ]);
    expect(codes(diagnostics)).toEqual(['import-disabled']);
    expect(diagnostics[0].level).toBe('info');
    expect(diagnostics[0].path).toEqual([
      'Test Element Data',
      'Port Battery Bank',
    ]);
  });
});

describe('assembleResolvedGraph — unreadable children', () => {
  it('warns and carries on with the rest of the tree', () => {
    const data = sampleBundle();
    data.graphs.delete(SAMPLES.EngineSystem.id);

    const { graph, diagnostics } = assembleResolvedGraph(ROOT, data);

    expect(graph!.children.map((child) => child.alias)).toEqual([
      'port_bank',
      'starboard_bank',
    ]);
    expect(codes(diagnostics)).toEqual(['child-unreadable']);
    expect(diagnostics[0].level).toBe('warning');
  });
});

describe('assembleResolvedGraph — limits', () => {
  it('resolves a chain exactly MAX_IMPORT_DEPTH graphs long', () => {
    const { graph, diagnostics } = assembleResolvedGraph(
      'g0',
      chainBundle(MAX_IMPORT_DEPTH)
    );

    expect(depthOf(graph!)).toBe(MAX_IMPORT_DEPTH);
    expect(diagnostics).toHaveLength(0);
  });

  it('truncates one graph deeper, rather than looping', () => {
    const { graph, diagnostics } = assembleResolvedGraph(
      'g0',
      chainBundle(MAX_IMPORT_DEPTH + 3)
    );

    expect(depthOf(graph!)).toBe(MAX_IMPORT_DEPTH);
    expect(codes(diagnostics)).toEqual(['resolution-truncated']);
    expect(diagnostics[0].level).toBe('warning');
  });

  it('truncates on the node budget too, and only says so once', () => {
    const { graph, diagnostics } = assembleResolvedGraph('g0', chainBundle(6), {
      maxNodes: 3,
    });

    expect(depthOf(graph!)).toBe(3);
    expect(codes(diagnostics)).toEqual(['resolution-truncated']);
  });
});

describe('assembleResolvedGraph — cycles', () => {
  it('terminates with a warning on a cycle built behind the hook’s back', () => {
    const data = chainBundle(2);
    // g0 → g1 → g0. The pb_hook refuses to write this; a malformed database
    // should still degrade to a warning rather than recurse forever.
    data.importsByParent.set('g1', [
      makeImport({ parent: 'g1', child: 'g0', alias: 'back' }),
    ]);

    const { graph, diagnostics } = assembleResolvedGraph('g0', data);

    expect(depthOf(graph!)).toBe(2);
    expect(codes(diagnostics)).toEqual(['import-cycle']);
    expect(diagnostics[0].level).toBe('warning');
  });

  it('terminates on a graph importing itself', () => {
    const data = chainBundle(1);
    data.importsByParent.set('g0', [
      makeImport({ parent: 'g0', child: 'g0', alias: 'self' }),
    ]);

    const { graph, diagnostics } = assembleResolvedGraph('g0', data);

    expect(graph!.children).toHaveLength(0);
    expect(codes(diagnostics)).toEqual(['import-cycle']);
  });

  it('keeps a diamond, which is reuse rather than a cycle', () => {
    const data = chainBundle(2);
    data.graphs.set('shared', makeGraph({ id: 'shared', label: 'Shared' }));
    data.nodesByGraph.set('shared', []);
    data.importsByParent.set('g0', [
      makeImport({ parent: 'g0', child: 'g1', alias: 'left' }),
      makeImport({ parent: 'g0', child: 'shared', alias: 'right', order: 1 }),
    ]);
    data.importsByParent.set('g1', [
      makeImport({ parent: 'g1', child: 'shared', alias: 'inner' }),
    ]);

    const { diagnostics } = assembleResolvedGraph('g0', data);
    expect(diagnostics).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The networked half
// ---------------------------------------------------------------------------

function createResolverPb(data: ResolvedGraphData) {
  const calls = { graphs: 0, imports: 0, nodes: 0 };
  const idsIn = (filter?: string) =>
    [...(filter ?? '').matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  const collections: Record<string, unknown> = {
    Graphs: {
      getOne: async (id: string) => {
        const graph = data.graphs.get(id);
        if (!graph) throw new Error('404 not found');
        return graph;
      },
      getFullList: async ({ filter }: { filter?: string }) => {
        calls.graphs++;
        return idsIn(filter)
          .map((id) => data.graphs.get(id))
          .filter(Boolean);
      },
    },
    GraphImports: {
      getFullList: async ({ filter }: { filter?: string }) => {
        calls.imports++;
        return idsIn(filter).flatMap(
          (id) => data.importsByParent.get(id) ?? []
        );
      },
    },
    GraphNodes: {
      getFullList: async ({ filter }: { filter?: string }) => {
        calls.nodes++;
        return idsIn(filter).flatMap((id) => data.nodesByGraph.get(id) ?? []);
      },
    },
  };

  const pb = {
    collection: (name: string) => collections[name],
  } as unknown as TypedPocketBase;

  return { pb, calls };
}

describe('loadImportTree', () => {
  it('batches one request per collection per depth level', async () => {
    const { pb, calls } = createResolverPb(sampleBundle());
    await loadImportTree(pb, ROOT);

    // Level 1 (the root) and level 2 (the three imports) — two rounds, and the
    // three imports of level 2 are fetched in a single request each, not one
    // per child.
    expect(calls.imports).toBe(2);
    expect(calls.nodes).toBe(2);
  });

  it('loads a child imported twice exactly once', async () => {
    const { pb } = createResolverPb(sampleBundle());
    const data = await loadImportTree(pb, ROOT);

    expect(data.graphs.size).toBe(3);
    expect(data.nodesByGraph.get(SAMPLES.BatterySystem.id)).toHaveLength(3);
  });

  it('does not spin on a cycle in the stored data', async () => {
    const bundle = chainBundle(2);
    bundle.importsByParent.set('g1', [
      makeImport({ parent: 'g1', child: 'g0', alias: 'back' }),
    ]);

    const { pb } = createResolverPb(bundle);
    const data = await loadImportTree(pb, 'g0');

    expect(data.graphs.size).toBe(2);
  });
});

describe('resolveGraph', () => {
  it('resolves the seeded tree end to end', async () => {
    const { pb } = createResolverPb(sampleBundle());
    const { graph, diagnostics } = await resolveGraph(pb, ROOT);

    expect(diagnostics).toHaveLength(0);
    expect(graph!.children.map((child) => child.label)).toEqual([
      'Port Battery Bank',
      'Starboard Battery Bank',
      'Control System',
    ]);
  });

  it('degrades to a diagnostic when the root cannot be read', async () => {
    const { pb } = createResolverPb(sampleBundle());
    const { graph, diagnostics } = await resolveGraph(pb, 'nobody');

    expect(graph).toBeNull();
    expect(codes(diagnostics)).toEqual(['child-unreadable']);
  });
});
