// Loading a graph and its import tree.
//
// This is the only file in `lib/graph/` that touches the network, which is why
// it is deliberately kept out of the `@project/shared` barrel. It splits in two:
//
//   loadImportTree      breadth-first, one batch per depth level  (networked)
//   assembleResolvedGraph  records → nested ResolvedGraph          (pure)
//
// The split is what makes the interesting behaviour — cycles, depth and node
// truncation, disabled and unreadable children — testable with plain data and
// no server at all.
//
// Reference: docs/IMPORTS.md § Resolution

import { MAX_IMPORT_DEPTH, MAX_RESOLVED_NODES } from './primitives';
import { buildGraphView } from './engine';
import type { Graph } from '../../schema/graph';
import type { GraphImport } from '../../schema/graph-import';
import type { GraphNode } from '../../schema/graph-node';
import { GraphMutator } from '../../mutators/graph';
import { GraphEdgeOverrideMutator } from '../../mutators/graph-edge-override';
import { GraphImportMutator } from '../../mutators/graph-import';
import { GraphNodeMutator } from '../../mutators/graph-node';
import { PortKindMutator } from '../../mutators/port-kind';
import type { TypedPocketBase } from '../../types';
import type {
  EngineOptions,
  GraphDiagnostic,
  GraphView,
  ResolvedChild,
  ResolvedGraph,
  ResolverResult,
} from './types';

/** Every record the assembler needs, keyed for lookup. */
export interface ResolvedGraphData {
  /** Readable graphs only — an unreadable child is simply absent. */
  graphs: Map<string, Graph>;
  /** Includes `enabled: false` rows; the assembler reports them. */
  importsByParent: Map<string, GraphImport[]>;
  nodesByGraph: Map<string, GraphNode[]>;
}

export interface AssembleOptions {
  maxDepth?: number;
  maxNodes?: number;
}

// ---------------------------------------------------------------------------
// The pure half
// ---------------------------------------------------------------------------

/**
 * Turn loaded records into the nested tree the engine consumes.
 *
 * Depth-first, because the output is nested — the *loading* is breadth-first,
 * which is a different concern. Guards, in the order they can fire:
 *
 * - a graph already on the current ancestor path is a cycle: prune that branch
 *   with a warning and carry on. The pb_hook prevents cycles on write, but a
 *   malformed database should degrade to a warning rather than hang;
 * - depth counts *graphs including the root*, so a chain of exactly
 *   `MAX_IMPORT_DEPTH` graphs resolves and the next one truncates;
 * - the node budget is all-or-nothing per subtree below the root, so a
 *   truncated picture is never a half-drawn subsystem.
 *
 * No memoization of assembled subtrees: `port_bank` and `starboard_bank` get
 * their own objects. Sharing one would leak a budget-truncated subtree from
 * whichever alias was walked first into the other.
 */
export function assembleResolvedGraph(
  rootId: string,
  data: ResolvedGraphData,
  options: AssembleOptions = {}
): { graph: ResolvedGraph | null; diagnostics: GraphDiagnostic[] } {
  const maxDepth = options.maxDepth ?? MAX_IMPORT_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_RESOLVED_NODES;

  const diagnostics: GraphDiagnostic[] = [];
  const onPath = new Set<string>();
  let nodeCount = 0;
  let truncated = false;

  const truncate = (message: string) => {
    if (truncated) return;
    truncated = true;
    diagnostics.push({
      level: 'warning',
      code: 'resolution-truncated',
      message,
    });
  };

  const build = (
    graphId: string,
    depth: number,
    breadcrumb: string[]
  ): ResolvedGraph | null => {
    const graph = data.graphs.get(graphId);
    if (!graph) return null;

    if (onPath.has(graphId)) {
      diagnostics.push({
        level: 'warning',
        code: 'import-cycle',
        message: `"${graph.label}" imports itself through ${breadcrumb.join(' › ')}; that branch was skipped.`,
        path: [...breadcrumb],
      });
      return null;
    }

    if (depth > maxDepth) {
      truncate(
        `Imports nest deeper than ${maxDepth} graphs; the tree below ${breadcrumb.join(' › ')} was not loaded.`
      );
      return null;
    }

    const nodes = data.nodesByGraph.get(graphId) ?? [];
    if (nodeCount + nodes.length > maxNodes) {
      truncate(
        `This graph resolves to more than ${maxNodes} nodes; the tree below ${breadcrumb.join(' › ')} was not loaded.`
      );
      return null;
    }
    nodeCount += nodes.length;

    onPath.add(graphId);

    const children: ResolvedChild[] = [];
    const imports = [...(data.importsByParent.get(graphId) ?? [])].sort(
      (left, right) =>
        left.order - right.order || (left.alias < right.alias ? -1 : 1)
    );

    for (const record of imports) {
      const child = data.graphs.get(record.child);
      const childLabel = record.label || child?.label || record.alias;
      const childPath = [...breadcrumb, childLabel];

      if (!record.enabled) {
        diagnostics.push({
          level: 'info',
          code: 'import-disabled',
          message: `"${childLabel}" is disabled and was not resolved.`,
          path: childPath,
        });
        continue;
      }

      if (!child) {
        diagnostics.push({
          level: 'warning',
          code: 'child-unreadable',
          message: `The graph imported as "${record.alias}" could not be read; it may have been deleted or made private.`,
          path: childPath,
        });
        continue;
      }

      const resolved = build(record.child, depth + 1, childPath);
      if (resolved) {
        children.push({
          alias: record.alias,
          label: record.label,
          graph: resolved,
        });
      }
    }

    onPath.delete(graphId);

    return {
      id: graph.id,
      uid: graph.uid,
      name: graph.name,
      label: graph.label,
      namespace: graph.namespace,
      nodes,
      children,
    };
  };

  const root = data.graphs.get(rootId);
  if (!root) {
    return {
      graph: null,
      diagnostics: [
        {
          level: 'error',
          code: 'child-unreadable',
          message: 'That graph could not be read.',
        },
      ],
    };
  }

  return { graph: build(rootId, 1, [root.label]), diagnostics };
}

// ---------------------------------------------------------------------------
// The networked half
// ---------------------------------------------------------------------------

/**
 * Breadth-first load, one batch of requests per depth level.
 *
 * Memoized by graph id across levels, so a diamond loads its shared child once
 * and a cycle in a malformed database cannot make the loader spin. Disabled
 * imports are loaded but not descended into — the assembler needs the rows to
 * report them.
 */
export async function loadImportTree(
  pb: TypedPocketBase,
  rootId: string,
  options: AssembleOptions = {}
): Promise<ResolvedGraphData> {
  const maxDepth = options.maxDepth ?? MAX_IMPORT_DEPTH;

  const graphMutator = new GraphMutator(pb);
  const importMutator = new GraphImportMutator(pb);
  const nodeMutator = new GraphNodeMutator(pb);

  const data: ResolvedGraphData = {
    graphs: new Map(),
    importsByParent: new Map(),
    nodesByGraph: new Map(),
  };

  const root = await graphMutator.getById(rootId);
  // An unreadable root leaves the map empty; the assembler reports it, so
  // there is one place that decides what a missing graph means.
  if (!root) return data;
  data.graphs.set(root.id, root);

  let level = [root.id];
  let depth = 1;

  // `depth <= maxDepth` deliberately loads one level of *graph records* beyond
  // the limit (never their nodes). Without it the assembler could not tell
  // "the tree ends here" from "the tree was cut off here", and the
  // `resolution-truncated` diagnostic would never fire.
  while (level.length && depth <= maxDepth) {
    const [imports, nodes] = await Promise.all([
      importMutator.listForParents(level),
      nodeMutator.listForGraphs(level),
    ]);

    for (const graphId of level) {
      if (!data.nodesByGraph.has(graphId)) data.nodesByGraph.set(graphId, []);
    }
    for (const node of nodes) {
      data.nodesByGraph.get(node.graph)?.push(node);
    }
    for (const record of imports) {
      const existing = data.importsByParent.get(record.parent);
      if (existing) existing.push(record);
      else data.importsByParent.set(record.parent, [record]);
    }

    const wanted = [
      ...new Set(
        imports
          .filter((record) => record.enabled)
          .map((record) => record.child)
          .filter((id) => !data.graphs.has(id))
      ),
    ];

    const children = await graphMutator.listByIds(wanted);
    for (const child of children) data.graphs.set(child.id, child);

    // Ids we asked for and did not get back were filtered out by the read
    // rules — deleted, or flipped to private since the import was recorded.
    // The assembler turns that into a `child-unreadable` diagnostic in place.
    level = children.map((child) => child.id);
    depth++;
  }

  return data;
}

/** Load a graph's import tree and assemble it. */
export async function resolveGraph(
  pb: TypedPocketBase,
  rootId: string,
  options: AssembleOptions = {}
): Promise<ResolverResult> {
  const data = await loadImportTree(pb, rootId, options);
  return assembleResolvedGraph(rootId, data, options);
}

/**
 * Resolve a graph and run the engine over it — what the viewer page calls.
 *
 * Overrides come from the **root** graph only: they do not inherit, because the
 * instance paths under a different parent are different paths.
 */
export async function resolveGraphView(
  pb: TypedPocketBase,
  rootId: string,
  options: Omit<EngineOptions, 'overrides' | 'portKinds' | 'diagnostics'> &
    AssembleOptions = {}
): Promise<GraphView> {
  const [resolved, overrides, portKinds] = await Promise.all([
    resolveGraph(pb, rootId, options),
    new GraphEdgeOverrideMutator(pb).listForGraph(rootId),
    new PortKindMutator(pb).registry(),
  ]);

  if (!resolved.graph) {
    return {
      nodes: [],
      edges: [],
      diagnostics: resolved.diagnostics,
      positions: {},
    };
  }

  return buildGraphView(resolved.graph, {
    ...options,
    overrides,
    portKinds,
    diagnostics: resolved.diagnostics,
  });
}
