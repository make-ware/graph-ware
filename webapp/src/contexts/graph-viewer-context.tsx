'use client';

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Graph,
  GraphEdgeOverride,
  GraphImport,
  GraphNode,
  GraphView,
} from '@project/shared';
import { buildGraphView } from '@project/shared';
import {
  GraphEdgeOverrideMutator,
  GraphImportMutator,
  GraphNodeMutator,
} from '@project/shared/mutators';
// The resolver is deliberately absent from the `@project/shared` barrel — it
// takes a PocketBase client — so it is imported by path, as its comment directs.
import {
  assembleResolvedGraph,
  loadImportTree,
  type ResolvedGraphData,
} from '@/lib/graph/resolver';
import type { ViewerSelection } from '@/lib/graph/flow-adapter';
import { usePortKinds } from '@/hooks/use-port-kinds';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@/types';

/** A focusable subgraph instance, for the sidebar. */
export interface SubgraphInstance {
  /** The instance path — what `?focus` carries. */
  path: string[];
  /** The import's label, falling back to the child graph's own. */
  label: string;
  /** The child `Graphs` record id, so the sidebar can link to its own route. */
  graphId: string;
  /** Nesting depth, for indentation. Root is 0. */
  depth: number;
  /** Colour index, matching the nodes on the canvas. */
  graphColorIndex: number;
  nodeCount: number;
}

export interface GraphViewerContextValue {
  /** The root graph record — title, visibility, ownership. */
  graph: Graph | null;
  view: GraphView;
  subgraphs: SubgraphInstance[];
  focus: string[];
  selection: ViewerSelection | null;
  /** False for a public graph belonging to someone else. */
  isOwner: boolean;
  isLoading: boolean;
  error: string | null;
  setFocus: (path: string[]) => void;
  select: (selection: ViewerSelection | null) => void;
  reload: () => void;
}

const EMPTY_VIEW: GraphView = {
  nodes: [],
  edges: [],
  diagnostics: [],
  positions: {},
};

const EMPTY_OVERRIDES: GraphEdgeOverride[] = [];

/** One completed load, tagged with the request that produced it. */
interface LoadedTree {
  /** `${rootId}#${reloadToken}` — what this load was asked for. */
  key: string;
  rootId: string;
  data: ResolvedGraphData;
  overrides: GraphEdgeOverride[];
}

const GraphViewerContext = createContext<GraphViewerContextValue | undefined>(
  undefined
);

interface GraphViewerProviderProps {
  rootId: string;
  focus: string[];
  selection: ViewerSelection | null;
  onFocusChange: (path: string[]) => void;
  onSelectionChange: (selection: ViewerSelection | null) => void;
  children: React.ReactNode;
}

/**
 * Resolve a graph, run the engine over it, and keep it live.
 *
 * Two things shape this provider:
 *
 * 1. **Focus must not refetch.** `resolveGraphView()` would re-run the network
 *    load on every focus change, so the load and the engine are split: the
 *    async half holds the raw `ResolvedGraphData`, and a synchronous memo turns
 *    it into a `GraphView`. Changing focus only re-runs the memo.
 * 2. **It is the provider Phase 4 extends.** Realtime patches replace records
 *    by id rather than appending, so the optimistic updates added later cannot
 *    double-insert against the `'*'` subscription.
 */
export function GraphViewerProvider({
  rootId,
  focus,
  selection,
  onFocusChange,
  onSelectionChange,
  children,
}: GraphViewerProviderProps) {
  const [loaded, setLoaded] = useState<LoadedTree | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const { registry } = usePortKinds();

  const client = pb as unknown as TypedPocketBase;

  // What the current props ask for. Deriving `isLoading` by comparing this
  // against what actually landed keeps the effect from calling setState
  // synchronously, which cascades renders (and trips `react-hooks`).
  const requestKey = `${rootId}#${reloadToken}`;

  // Guards a stale in-flight load landing after a newer one — switching graphs
  // quickly, or a realtime re-resolve racing the initial fetch.
  const loadGeneration = useRef(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  useEffect(() => {
    const generation = ++loadGeneration.current;
    let cancelled = false;

    const stale = () => cancelled || generation !== loadGeneration.current;

    Promise.all([
      loadImportTree(client, rootId),
      new GraphEdgeOverrideMutator(client).listForGraph(rootId),
    ])
      .then(([data, overrides]) => {
        if (stale()) return;
        setLoaded({ key: requestKey, rootId, data, overrides });
      })
      .catch((cause: unknown) => {
        if (stale()) return;
        console.error('Failed to resolve graph', cause);
        setFailure({
          key: requestKey,
          message: 'That graph could not be loaded.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, rootId, requestKey]);

  // The previous tree stays on screen while a reload is in flight, so a
  // realtime-triggered re-resolve does not blank the canvas.
  const settled = loaded?.key === requestKey || failure?.key === requestKey;
  const isLoading = !settled;
  const error = failure?.key === requestKey ? failure.message : null;

  // A tree loaded for a different graph must not be rendered under this one.
  const data = loaded?.rootId === rootId ? loaded.data : null;
  const overrides =
    loaded?.rootId === rootId ? loaded.overrides : EMPTY_OVERRIDES;

  // -------------------------------------------------------------------------
  // Engine — synchronous, so focus changes cost nothing
  // -------------------------------------------------------------------------

  const resolved = useMemo(() => {
    if (!data) return null;
    return assembleResolvedGraph(rootId, data);
  }, [data, rootId]);

  const view = useMemo<GraphView>(() => {
    if (!resolved?.graph) return EMPTY_VIEW;

    return buildGraphView(resolved.graph, {
      overrides,
      portKinds: registry,
      focus,
      diagnostics: resolved.diagnostics,
    });
  }, [resolved, overrides, registry, focus]);

  const subgraphs = useMemo(
    () => (resolved?.graph ? collectSubgraphs(resolved.graph) : []),
    [resolved]
  );

  const graph = data?.graphs.get(rootId) ?? null;

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!data) return;

    const loadedGraphIds = new Set(data.graphs.keys());
    let disposed = false;

    // `subscribeToCollection`'s second argument is `expand`, not options —
    // there is no server-side filter, so every readable record arrives here and
    // is matched against the resolved set by hand.
    const nodeMutator = new GraphNodeMutator(client);
    const importMutator = new GraphImportMutator(client);

    const onNode = ({
      action,
      record,
    }: {
      action: string;
      record: GraphNode;
    }) => {
      if (disposed) return;

      // A node on a graph we never loaded can only matter if the import tree
      // changed underneath us, which the import subscription handles.
      if (!loadedGraphIds.has(record.graph)) return;

      setLoaded((current) =>
        current
          ? { ...current, data: patchNode(current.data, action, record) }
          : current
      );
    };

    const onImport = ({ record }: { action: string; record: GraphImport }) => {
      if (disposed) return;

      // Only reload for imports inside this tree. Any change to one can pull in
      // a child graph that was never fetched, so patching is not an option —
      // re-resolve and let the loader work out what is now reachable.
      if (!loadedGraphIds.has(record.parent)) return;
      reload();
    };

    const subscriptions = Promise.all([
      nodeMutator.subscribeToCollection(onNode),
      importMutator.subscribeToCollection(onImport),
    ]).catch((cause: unknown) => {
      console.error('Graph realtime subscription failed', cause);
      return [] as (() => void)[];
    });

    return () => {
      disposed = true;
      // The subscribe calls are async, so unsubscribing has to wait for them
      // to settle — otherwise a subscription created after unmount leaks.
      void subscriptions.then((unsubscribers) => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      });
    };
  }, [client, data, reload]);

  // -------------------------------------------------------------------------

  const isOwner = Boolean(
    graph && pb.authStore.record?.id && graph.owner === pb.authStore.record.id
  );

  const value: GraphViewerContextValue = {
    graph,
    view,
    subgraphs,
    focus,
    selection,
    isOwner,
    isLoading,
    error,
    setFocus: onFocusChange,
    select: onSelectionChange,
    reload,
  };

  return (
    <GraphViewerContext.Provider value={value}>
      {children}
    </GraphViewerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply one realtime event to the loaded node map.
 *
 * Replace-by-id rather than append, and a new array for the touched graph so
 * the `useMemo` chain actually re-runs. Phase 4's optimistic updates write
 * through the same path, which is why a create is treated as an upsert.
 */
function patchNode(
  current: ResolvedGraphData,
  action: string,
  record: GraphNode
): ResolvedGraphData {
  const existing = current.nodesByGraph.get(record.graph) ?? [];

  const next =
    action === 'delete'
      ? existing.filter((node) => node.id !== record.id)
      : upsertById(existing, record);

  const nodesByGraph = new Map(current.nodesByGraph);
  nodesByGraph.set(record.graph, next);

  return { ...current, nodesByGraph };
}

function upsertById(nodes: GraphNode[], record: GraphNode): GraphNode[] {
  const index = nodes.findIndex((node) => node.id === record.id);
  if (index === -1) return [...nodes, record];

  const next = [...nodes];
  next[index] = record;
  return next;
}

/**
 * Flatten the resolved tree into sidebar entries, in the same depth-first order
 * the engine assigns `graphColorIndex` — so the sidebar swatch matches the node
 * border for every instance.
 */
function collectSubgraphs(
  root: Parameters<typeof buildGraphView>[0]
): SubgraphInstance[] {
  const entries: SubgraphInstance[] = [];
  let colorIndex = 0;

  const walk = (
    graph: typeof root,
    path: string[],
    label: string,
    depth: number
  ) => {
    entries.push({
      path,
      label,
      graphId: graph.id,
      depth,
      graphColorIndex: colorIndex++,
      nodeCount: graph.nodes.length,
    });

    for (const child of graph.children) {
      walk(
        child.graph,
        [...path, child.alias],
        child.label || child.graph.label,
        depth + 1
      );
    }
  };

  walk(root, [], root.label, 0);
  return entries;
}

export { GraphViewerContext };
