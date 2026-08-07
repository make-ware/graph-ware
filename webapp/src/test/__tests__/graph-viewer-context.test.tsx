import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { GraphImport, GraphNode } from '@project/shared';
import { SAMPLES, sampleBundle } from './fixtures/graph-fixtures';

// ---------------------------------------------------------------------------
// A PocketBase stand-in with per-collection records and real subscriptions.
//
// `fixtures/pocketbase.ts` returns one shared collection for every name and has
// no `subscribe`, which is exactly the two things this provider needs — so the
// mock is built here rather than bending that fixture out of shape for the
// auth tests that depend on it.
// ---------------------------------------------------------------------------

type Listener = (event: { action: string; record: unknown }) => void;

const ROOT_ID = SAMPLES.testDataElement.id;

/**
 * Enough of PocketBase's filter syntax for the resolver's queries, which are
 * all `field = "value"` clauses joined with `||`.
 */
function applyFilter<T>(records: T[], filter?: string): T[] {
  if (!filter) return records;

  const clauses = [...filter.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map(
    ([, field, value]) => ({ field, value })
  );
  if (!clauses.length) return records;

  return records.filter((record) =>
    clauses.some(
      ({ field, value }) => (record as Record<string, unknown>)[field] === value
    )
  );
}

function createGraphPb() {
  const bundle = sampleBundle();

  const records: Record<string, unknown[]> = {
    Graphs: [...bundle.graphs.values()],
    GraphNodes: [...bundle.nodesByGraph.values()].flat(),
    GraphImports: [...bundle.importsByParent.values()].flat(),
    GraphEdgeOverrides: [],
    PortKinds: [],
  };

  const listeners = new Map<string, Set<Listener>>();
  const unsubscribes: ReturnType<typeof vi.fn>[] = [];
  const calls = { getFullList: 0, getOne: 0 };

  const collection = (name: string) => ({
    getOne: vi.fn(async (id: string) => {
      calls.getOne++;
      const found = (records[name] ?? []).find(
        (record) => (record as { id: string }).id === id
      );
      if (!found) throw Object.assign(new Error('not found'), { status: 404 });
      return found;
    }),
    // The filter has to be honoured: `loadImportTree` appends whatever comes
    // back to the maps it is building, so an over-broad result would push the
    // same imports in twice and duplicate the whole tree.
    getFullList: vi.fn(async (options?: { filter?: string }) => {
      calls.getFullList++;
      return applyFilter(records[name] ?? [], options?.filter);
    }),
    getList: vi.fn(async () => ({ items: records[name] ?? [], totalItems: 0 })),
    subscribe: vi.fn(async (_topic: string, listener: Listener) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);

      const unsubscribe = vi.fn(() => set.delete(listener));
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    }),
    unsubscribe: vi.fn(),
  });

  const collections = new Map<string, ReturnType<typeof collection>>();

  const pb = {
    authStore: { record: { id: 'demo_user_id' }, isValid: true },
    collection: vi.fn((name: string) => {
      const existing = collections.get(name);
      if (existing) return existing;
      const created = collection(name);
      collections.set(name, created);
      return created;
    }),
  };

  const emit = (name: string, action: string, record: unknown) => {
    for (const listener of listeners.get(name) ?? []) {
      listener({ action, record });
    }
  };

  return { pb, records, emit, calls, unsubscribes };
}

let harness: ReturnType<typeof createGraphPb>;

vi.mock('@/lib/pocketbase', () => ({
  get default() {
    return harness.pb;
  },
}));

// Imported after the mock so the provider picks up the stubbed client.
const { GraphViewerProvider } = await import('@/contexts/graph-viewer-context');
const { useGraphViewer } = await import('@/hooks/use-graph-viewer');

// ---------------------------------------------------------------------------

interface Captured {
  nodeCount: number;
  nodeNames: string[];
  instanceIds: string[];
  errorCodes: string[];
  subgraphLabels: string[];
  isOwner: boolean;
}

let captured: Captured | null = null;

function Probe() {
  const { view, subgraphs, isOwner } = useGraphViewer();

  captured = {
    nodeCount: view.nodes.length,
    nodeNames: view.nodes.map((node) => node.name),
    instanceIds: view.nodes.map((node) => node.instanceId),
    errorCodes: view.diagnostics
      .filter((entry) => entry.level === 'error')
      .map((entry) => entry.code),
    subgraphLabels: subgraphs.map((entry) => entry.label),
    isOwner,
  };

  return null;
}

function renderViewer(focus: string[] = []) {
  return render(
    <GraphViewerProvider
      rootId={ROOT_ID}
      focus={focus}
      selection={null}
      onFocusChange={vi.fn()}
      onSelectionChange={vi.fn()}
    >
      <Probe />
    </GraphViewerProvider>
  );
}

beforeEach(() => {
  harness = createGraphPb();
  captured = null;
});

describe('GraphViewerProvider', () => {
  it('resolves the import tree and runs the engine', async () => {
    renderViewer();

    await waitFor(() => expect(captured?.nodeCount).toBeGreaterThan(0));

    // 3 BatterySystem nodes twice, plus 1 EngineSystem node.
    expect(captured?.nodeCount).toBe(7);
    expect(captured?.subgraphLabels).toEqual([
      'Test Element Data',
      'Port Battery Bank',
      'Starboard Battery Bank',
      'Control System',
    ]);
  });

  it('satisfies the Cerbo GX required input from the battery fuse', async () => {
    renderViewer();

    await waitFor(() => expect(captured?.nodeCount).toBe(7));
    // In the whole tree the fuse's `many` power output reaches the Cerbo, so
    // the required input is connected and there is nothing to report.
    expect(captured?.errorCodes).not.toContain('required-input-unconnected');
  });

  it('reports the Cerbo GX required input once the engine bay is focused', async () => {
    // Focus drops the battery banks, which is what leaves the input dangling —
    // the diagnostic is a property of the view, not of the stored data.
    renderViewer(['control']);

    await waitFor(() => expect(captured?.nodeCount).toBe(1));
    expect(captured?.errorCodes).toContain('required-input-unconnected');
  });

  it('marks the signed-in owner as owner', async () => {
    renderViewer();

    await waitFor(() => expect(captured?.isOwner).toBe(true));
  });

  it('treats another user’s graph as read-only', async () => {
    for (const record of harness.records.Graphs) {
      (record as { owner: string }).owner = 'someone_else';
    }

    renderViewer();

    await waitFor(() => expect(captured?.nodeCount).toBe(7));
    expect(captured?.isOwner).toBe(false);
  });

  it('recomputes on a focus change without refetching', async () => {
    const { rerender } = renderViewer();

    await waitFor(() => expect(captured?.nodeCount).toBe(7));
    const fetchesAfterLoad = harness.calls.getFullList;

    rerender(
      <GraphViewerProvider
        rootId={ROOT_ID}
        focus={['port_bank']}
        selection={null}
        onFocusChange={vi.fn()}
        onSelectionChange={vi.fn()}
      >
        <Probe />
      </GraphViewerProvider>
    );

    await waitFor(() => expect(captured?.nodeCount).toBe(3));

    // The whole point of splitting the load from the engine.
    expect(harness.calls.getFullList).toBe(fetchesAfterLoad);
    expect(
      captured?.instanceIds.every((id) => id.startsWith('port_bank/'))
    ).toBe(true);
  });

  it('focuses the two battery banks independently', async () => {
    renderViewer(['port_bank']);
    await waitFor(() => expect(captured?.nodeCount).toBe(3));
    const port = captured!.instanceIds;

    renderViewer(['starboard_bank']);
    await waitFor(() =>
      expect(
        captured?.instanceIds.every((id) => id.startsWith('starboard_bank/'))
      ).toBe(true)
    );

    // Same components, different instances — the case a record id cannot express.
    expect(captured?.nodeNames.sort()).toEqual(
      ['house_battery_1', 'house_battery_2', 'house_fuse'].sort()
    );
    expect(captured?.instanceIds).not.toEqual(port);
  });

  it('patches a GraphNodes update in place, without refetching', async () => {
    renderViewer();
    await waitFor(() => expect(captured?.nodeCount).toBe(7));

    const fetchesAfterLoad = harness.calls.getFullList;
    const target = harness.records.GraphNodes[0] as GraphNode;

    await act(async () => {
      harness.emit('GraphNodes', 'update', { ...target, label: 'Renamed' });
    });

    await waitFor(() => {
      const node = captured?.nodeNames.length ? captured : null;
      expect(node).not.toBeNull();
    });

    expect(harness.calls.getFullList).toBe(fetchesAfterLoad);
    expect(captured?.nodeCount).toBe(7);
  });

  it('drops a deleted node from every instance it appeared under', async () => {
    renderViewer();
    await waitFor(() => expect(captured?.nodeCount).toBe(7));

    const battery = (harness.records.GraphNodes as GraphNode[]).find(
      (node) => node.name === 'house_battery_1'
    )!;

    await act(async () => {
      harness.emit('GraphNodes', 'delete', battery);
    });

    // Removed once per import instance — the record appears twice in the tree.
    await waitFor(() => expect(captured?.nodeCount).toBe(5));
  });

  it('ignores realtime events for graphs outside the resolved tree', async () => {
    renderViewer();
    await waitFor(() => expect(captured?.nodeCount).toBe(7));

    await act(async () => {
      harness.emit('GraphNodes', 'create', {
        id: 'stranger',
        graph: 'some_other_graph',
        name: 'stranger',
        label: 'Stranger',
        ports: [],
        attributes: [],
      });
    });

    expect(captured?.nodeCount).toBe(7);
  });

  it('re-resolves when an import inside the tree changes', async () => {
    renderViewer();
    await waitFor(() => expect(captured?.nodeCount).toBe(7));

    const fetchesAfterLoad = harness.calls.getFullList;
    const record = harness.records.GraphImports[0] as GraphImport;

    await act(async () => {
      harness.emit('GraphImports', 'update', {
        ...record,
        label: 'Renamed bank',
      });
    });

    // An import change can introduce a graph that was never loaded, so this one
    // must go back to the network rather than patch.
    await waitFor(() =>
      expect(harness.calls.getFullList).toBeGreaterThan(fetchesAfterLoad)
    );
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderViewer();
    await waitFor(() => expect(captured?.nodeCount).toBe(7));
    await waitFor(() => expect(harness.unsubscribes.length).toBe(2));

    unmount();

    await waitFor(() => {
      expect(harness.unsubscribes.every((fn) => fn.mock.calls.length > 0)).toBe(
        true
      );
    });
  });
});
