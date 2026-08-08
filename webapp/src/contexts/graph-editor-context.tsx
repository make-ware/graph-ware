'use client';

import React, { createContext, useCallback, useMemo, useState } from 'react';
import type {
  AttributeOverrideMap,
  GraphEdgeOverride,
  GraphEdgeOverrideInput,
  GraphImport,
  GraphInput,
  GraphNode,
  GraphNodeInput,
  GraphVersion,
  NodePosition,
} from '@project/shared';
import { isUnderAlias, rewriteAliasPrefix } from '@project/shared';
import {
  GraphEdgeOverrideMutator,
  GraphImportMutator,
  GraphMutator,
  GraphNodeMutator,
  GraphVersionMutator,
} from '@project/shared/mutators';
import { useGraphViewer } from '@/hooks/use-graph-viewer';
import pb from '@/lib/pocketbase';
import type { TypedPocketBase } from '@project/shared/types';

/**
 * What a pending alias rename will do to the overrides underneath it.
 *
 * The import manager shows this before committing, because the rewrite touches
 * records the user is not looking at.
 */
export interface AliasRenameImpact {
  /** Overrides whose `sourcePath` or `targetPath` sits under the old alias. */
  affected: GraphEdgeOverride[];
}

export interface GraphEditorContextValue {
  /** True while any write is in flight — for disabling submit buttons. */
  isSaving: boolean;

  // Graph
  saveGraph: (input: Partial<GraphInput>) => Promise<void>;
  deleteGraph: () => Promise<boolean>;

  // Nodes
  createNode: (input: Omit<GraphNodeInput, 'graph'>) => Promise<GraphNode>;
  saveNode: (
    id: string,
    input: Omit<GraphNodeInput, 'graph'>
  ) => Promise<GraphNode>;
  deleteNode: (id: string) => Promise<boolean>;

  // Layout
  setNodePosition: (id: string, position: NodePosition) => Promise<void>;
  resetLayout: () => Promise<void>;

  // Imports
  addImport: (childId: string, label?: string) => Promise<GraphImport>;
  updateImport: (
    id: string,
    patch: Partial<Pick<GraphImport, 'label' | 'enabled'>>
  ) => Promise<void>;
  renameAlias: (id: string, alias: string) => Promise<void>;
  aliasRenameImpact: (alias: string) => AliasRenameImpact;
  removeImport: (id: string) => Promise<void>;
  moveImport: (id: string, direction: -1 | 1) => Promise<void>;
  /** Pin an import to a version, or pass `null` to follow the child again. */
  pinImport: (id: string, versionId: string | null) => Promise<void>;
  /** Replace an import's per-instance attribute overrides. */
  setImportOverrides: (
    id: string,
    overrides: AttributeOverrideMap
  ) => Promise<void>;

  // Versions
  publishVersion: (note?: string) => Promise<GraphVersion>;
  restoreVersion: (version: GraphVersion) => Promise<void>;

  // Overrides
  createOverride: (
    input: Omit<GraphEdgeOverrideInput, 'graph'>
  ) => Promise<GraphEdgeOverride>;
  deleteOverride: (id: string) => Promise<void>;
}

const GraphEditorContext = createContext<GraphEditorContextValue | undefined>(
  undefined
);

/**
 * Every write the editor makes.
 *
 * Deliberately *not* a fork of `GraphViewerProvider`. That provider already
 * resolves the tree, runs the engine and keeps both live, and it patches
 * records by id precisely so optimistic writes cannot double-insert against
 * its `'*'` subscription. This one composes it and owns nothing but mutation,
 * so there is a single source of truth for what the graph currently is.
 *
 * Errors are re-thrown rather than swallowed: the forms map them onto fields
 * with `parseAuthError` / `getFieldError`, which needs the original
 * `ClientResponseError`.
 */
export function GraphEditorProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    graph,
    rootNodes,
    rootImports,
    overrides,
    applyNodePatch,
    applyOverridePatch,
    reload,
  } = useGraphViewer();

  const [pending, setPending] = useState(0);

  const client = pb as unknown as TypedPocketBase;

  const mutators = useMemo(
    () => ({
      graphs: new GraphMutator(client),
      nodes: new GraphNodeMutator(client),
      imports: new GraphImportMutator(client),
      overrides: new GraphEdgeOverrideMutator(client),
      versions: new GraphVersionMutator(client),
    }),
    [client]
  );

  const graphId = graph?.id ?? null;

  /** Run a write with the saving counter held up, whatever the outcome. */
  const tracked = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      setPending((count) => count + 1);
      try {
        return await work();
      } finally {
        setPending((count) => count - 1);
      }
    },
    []
  );

  const requireGraph = useCallback((): string => {
    if (!graphId) throw new Error('The graph has not finished loading.');
    return graphId;
  }, [graphId]);

  // -------------------------------------------------------------------------
  // Graph
  // -------------------------------------------------------------------------

  const saveGraph = useCallback(
    async (input: Partial<GraphInput>) => {
      const id = requireGraph();
      await tracked(() => mutators.graphs.update(id, input));
      // The viewer does not subscribe to `Graphs`, so the header would keep
      // showing the old label until something else forced a reload.
      reload();
    },
    [mutators, requireGraph, tracked, reload]
  );

  const deleteGraph = useCallback(async () => {
    const id = requireGraph();
    return await tracked(() => mutators.graphs.delete(id));
  }, [mutators, requireGraph, tracked]);

  // -------------------------------------------------------------------------
  // Nodes
  //
  // Ports and attributes are JSON on the record, so a node saves as one write.
  // There is no per-port save.
  // -------------------------------------------------------------------------

  const createNode = useCallback(
    async (input: Omit<GraphNodeInput, 'graph'>) => {
      const id = requireGraph();
      const record = await tracked(() =>
        mutators.nodes.create({ ...input, graph: id })
      );
      applyNodePatch('create', record);
      return record;
    },
    [mutators, requireGraph, tracked, applyNodePatch]
  );

  const saveNode = useCallback(
    async (id: string, input: Omit<GraphNodeInput, 'graph'>) => {
      const graphRecordId = requireGraph();
      const record = await tracked(() =>
        mutators.nodes.update(id, { ...input, graph: graphRecordId })
      );
      applyNodePatch('update', record);
      return record;
    },
    [mutators, requireGraph, tracked, applyNodePatch]
  );

  const deleteNode = useCallback(
    async (id: string) => {
      const existing = rootNodes.find((node) => node.id === id);
      const removed = await tracked(() => mutators.nodes.delete(id));
      if (removed && existing) applyNodePatch('delete', existing);
      return removed;
    },
    [mutators, rootNodes, tracked, applyNodePatch]
  );

  // -------------------------------------------------------------------------
  // Layout
  //
  // `position` lives on the record, but the canvas is keyed by instance id and
  // a twice-imported node is one record under two ids. The engine already
  // settled this by ignoring `position` below the root (see `flattenGraph`), so
  // only root-graph nodes are ever positioned here.
  // -------------------------------------------------------------------------

  const setNodePosition = useCallback(
    async (id: string, position: NodePosition) => {
      const existing = rootNodes.find((node) => node.id === id);

      // Applied before the request, not after: the canvas hands its local drag
      // position back at drag stop, so anything slower than this shows the node
      // snapping to its old spot until the write lands. The realtime echo and
      // the resolved record both replace this by id rather than appending.
      if (existing) applyNodePatch('update', { ...existing, position });

      const record = await tracked(() =>
        mutators.nodes.update(id, { position })
      );
      applyNodePatch('update', record);
    },
    [mutators, rootNodes, tracked, applyNodePatch]
  );

  const resetLayout = useCallback(async () => {
    const positioned = rootNodes.filter((node) => node.position);
    if (!positioned.length) return;

    await tracked(async () => {
      for (const node of positioned) {
        // PocketBase clears an optional JSON field with `null`, not `undefined`
        // — an undefined key is dropped from the payload and the field survives.
        const record = await mutators.nodes.update(node.id, {
          position: null as unknown as NodePosition,
        });
        applyNodePatch('update', record);
      }
    });
  }, [mutators, rootNodes, tracked, applyNodePatch]);

  // -------------------------------------------------------------------------
  // Imports
  // -------------------------------------------------------------------------

  const addImport = useCallback(
    async (childId: string, label?: string) => {
      const id = requireGraph();
      // `addImport` re-checks the cycle rules and allocates a free alias, so
      // importing the same child twice lands as `battery_system_2` rather than
      // failing the unique index.
      const record = await tracked(() =>
        mutators.imports.addImport(id, childId, { label })
      );
      // An import can pull in a graph that was never fetched, so this is a
      // re-resolve rather than a patch — the same reason the realtime handler
      // reloads instead of patching.
      reload();
      return record;
    },
    [mutators, requireGraph, tracked, reload]
  );

  const updateImport = useCallback(
    async (
      id: string,
      patch: Partial<Pick<GraphImport, 'label' | 'enabled'>>
    ) => {
      await tracked(() => mutators.imports.update(id, patch));
      reload();
    },
    [mutators, tracked, reload]
  );

  /**
   * Overrides that a rename of `alias` would invalidate.
   *
   * Both endpoints are checked: an override can point *into* a subtree as
   * easily as out of it.
   */
  const aliasRenameImpact = useCallback(
    (alias: string): AliasRenameImpact => ({
      affected: overrides.filter(
        (override) =>
          isUnderAlias(override.sourcePath, alias) ||
          isUnderAlias(override.targetPath, alias)
      ),
    }),
    [overrides]
  );

  const renameAlias = useCallback(
    async (id: string, alias: string) => {
      const existing = rootImports.find((row) => row.id === id);
      if (!existing) throw new Error('That import no longer exists.');
      if (existing.alias === alias) return;

      const previous = existing.alias;

      await tracked(async () => {
        await mutators.imports.update(id, { alias });

        // Rewrite the overrides that named the old alias. PocketBase has no
        // multi-record transaction, so this can half-apply; the override
        // panel's stale detection is what catches that. Documented in
        // docs/IMPORTS.md § Renaming an alias.
        for (const override of overrides) {
          const sourcePath = rewriteAliasPrefix(
            override.sourcePath,
            previous,
            alias
          );
          const targetPath = rewriteAliasPrefix(
            override.targetPath,
            previous,
            alias
          );
          if (
            sourcePath === override.sourcePath &&
            targetPath === override.targetPath
          ) {
            continue;
          }

          const record = await mutators.overrides.update(override.id, {
            sourcePath,
            targetPath,
          });
          applyOverridePatch('update', record);
        }
      });

      reload();
    },
    [mutators, rootImports, overrides, tracked, applyOverridePatch, reload]
  );

  const removeImport = useCallback(
    async (id: string) => {
      await tracked(() => mutators.imports.delete(id));
      reload();
    },
    [mutators, tracked, reload]
  );

  /**
   * Swap an import with its neighbour.
   *
   * `order` is rewritten across the whole list rather than swapping two values,
   * because seeded and hand-edited rows are not guaranteed to be contiguous.
   */
  const moveImport = useCallback(
    async (id: string, direction: -1 | 1) => {
      const ordered = [...rootImports].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex((row) => row.id === id);
      if (index === -1) return;

      const target = index + direction;
      if (target < 0 || target >= ordered.length) return;

      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];

      await tracked(async () => {
        for (const [position, row] of ordered.entries()) {
          if (row.order === position) continue;
          await mutators.imports.update(row.id, { order: position });
        }
      });

      reload();
    },
    [mutators, rootImports, tracked, reload]
  );

  /**
   * Pin an import to a snapshot, or unpin it.
   *
   * A reload rather than a patch: pinning changes which *records* the resolver
   * loads for that subtree, so the loaded tree has to be rebuilt — the same
   * reason `addImport` reloads.
   */
  const pinImport = useCallback(
    async (id: string, versionId: string | null) => {
      await tracked(() => mutators.imports.setVersion(id, versionId));
      reload();
    },
    [mutators, tracked, reload]
  );

  const setImportOverrides = useCallback(
    async (id: string, overrides: AttributeOverrideMap) => {
      await tracked(() =>
        mutators.imports.setAttributeOverrides(id, overrides)
      );
      reload();
    },
    [mutators, tracked, reload]
  );

  // -------------------------------------------------------------------------
  // Versions
  // -------------------------------------------------------------------------

  /**
   * Freeze the graph as it stands.
   *
   * Reads the stored form off the viewer rather than refetching it: resolution
   * has already loaded exactly these records, and a snapshot taken from a
   * second fetch could differ from what the user is looking at.
   */
  const publishVersion = useCallback(
    async (note?: string) => {
      if (!graph) throw new Error('The graph has not finished loading.');
      return await tracked(() =>
        mutators.versions.publish(graph, rootNodes, rootImports, note)
      );
    },
    [graph, mutators, rootNodes, rootImports, tracked]
  );

  const restoreVersion = useCallback(
    async (version: GraphVersion) => {
      if (!graph) throw new Error('The graph has not finished loading.');

      await tracked(() =>
        mutators.versions.restore(graph, version, {
          nodes: rootNodes,
          imports: rootImports,
        })
      );
      // A restore rewrites nodes *and* imports, so the tree is re-resolved
      // rather than patched — the import list may name graphs never loaded.
      reload();
    },
    [graph, mutators, rootNodes, rootImports, tracked, reload]
  );

  // -------------------------------------------------------------------------
  // Overrides
  // -------------------------------------------------------------------------

  const createOverride = useCallback(
    async (input: Omit<GraphEdgeOverrideInput, 'graph'>) => {
      const id = requireGraph();
      const record = await tracked(() =>
        mutators.overrides.create({ ...input, graph: id })
      );
      applyOverridePatch('create', record);
      return record;
    },
    [mutators, requireGraph, tracked, applyOverridePatch]
  );

  const deleteOverride = useCallback(
    async (id: string) => {
      const existing = overrides.find((row) => row.id === id);
      const removed = await tracked(() => mutators.overrides.delete(id));
      if (removed && existing) applyOverridePatch('delete', existing);
    },
    [mutators, overrides, tracked, applyOverridePatch]
  );

  const value: GraphEditorContextValue = {
    isSaving: pending > 0,
    saveGraph,
    deleteGraph,
    createNode,
    saveNode,
    deleteNode,
    setNodePosition,
    resetLayout,
    addImport,
    updateImport,
    renameAlias,
    aliasRenameImpact,
    removeImport,
    moveImport,
    pinImport,
    setImportOverrides,
    publishVersion,
    restoreVersion,
    createOverride,
    deleteOverride,
  };

  return (
    <GraphEditorContext.Provider value={value}>
      {children}
    </GraphEditorContext.Provider>
  );
}

export { GraphEditorContext };
