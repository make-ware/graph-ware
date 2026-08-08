// Loading a graph and its import tree.
//
// One of the two files in `lib/graph/` that touch the network, which is why it
// is kept out of the bare `@project/shared` barrel and reached through
// `@project/shared/graph` instead. It splits in two:
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
import { parseSnapshot, snapshotToImports, snapshotToNodes } from './snapshot';
import type { Graph } from '../../schema/graph';
import type { GraphImport } from '../../schema/graph-import';
import type { GraphNode } from '../../schema/graph-node';
import type { GraphVersion } from '../../schema/graph-version';
import { GraphMutator } from '../../mutators/graph';
import { GraphEdgeOverrideMutator } from '../../mutators/graph-edge-override';
import { GraphImportMutator } from '../../mutators/graph-import';
import { GraphNodeMutator } from '../../mutators/graph-node';
import { GraphVersionMutator } from '../../mutators/graph-version';
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

/** A pinned import's frozen contents, already unpacked from its snapshot. */
export interface PinnedGraph {
  /** `GraphVersions.version` — the number, for the UI. */
  version: number;
  nodes: GraphNode[];
  imports: GraphImport[];
}

/** Every record the assembler needs, keyed for lookup. */
export interface ResolvedGraphData {
  /** Readable graphs only — an unreadable child is simply absent. */
  graphs: Map<string, Graph>;
  /** Includes `enabled: false` rows; the assembler reports them. */
  importsByParent: Map<string, GraphImport[]>;
  nodesByGraph: Map<string, GraphNode[]>;
  /**
   * Snapshots behind the tree's pinned imports, keyed by `GraphVersions` id.
   *
   * Keyed by version rather than by import so that two imports pinned to the
   * same version share one unpacked copy — the diamond case, which is common
   * once a library component settles down.
   */
  pins: Map<string, PinnedGraph>;
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
 * whichever alias was walked first into the other — and since Phase 5 the two
 * can also be pinned to different versions of the same child.
 *
 * A **pinned** import takes its nodes and its own import rows from the snapshot
 * in `data.pins` instead of from the live maps. Its children are then resolved
 * live unless they carried pins of their own: the snapshot is one level deep,
 * for the reasons in `GraphSnapshotSchema`.
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
    breadcrumb: string[],
    pinned?: PinnedGraph
  ): ResolvedGraph | null => {
    const graph = data.graphs.get(graphId);
    if (!graph) return null;

    // A pinned instance is not the live graph, so it does not close a cycle
    // with one — but two pins of the same version *do* close one with each
    // other. Keying the path by version keeps both cases right.
    const pathKey = pinned ? `${graphId}@${pinned.version}` : graphId;

    if (onPath.has(pathKey)) {
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

    const nodes = pinned
      ? pinned.nodes
      : (data.nodesByGraph.get(graphId) ?? []);
    if (nodeCount + nodes.length > maxNodes) {
      truncate(
        `This graph resolves to more than ${maxNodes} nodes; the tree below ${breadcrumb.join(' › ')} was not loaded.`
      );
      return null;
    }
    nodeCount += nodes.length;

    onPath.add(pathKey);

    const children: ResolvedChild[] = [];
    const imports = [
      ...(pinned ? pinned.imports : (data.importsByParent.get(graphId) ?? [])),
    ].sort(
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

      // A pin that cannot be loaded falls back to live rather than dropping the
      // subtree. The picture is then wrong in a way the user can see and fix;
      // an empty branch is wrong in a way they cannot.
      let childPin: PinnedGraph | undefined;
      if (record.version) {
        childPin = data.pins.get(record.version);
        if (!childPin) {
          diagnostics.push({
            level: 'warning',
            code: 'version-unreadable',
            message: `"${childLabel}" is pinned to a version that could not be read; it was resolved from the current graph instead.`,
            path: childPath,
          });
        }
      }

      const resolved = build(record.child, depth + 1, childPath, childPin);
      if (resolved) {
        children.push({
          alias: record.alias,
          label: record.label,
          attributeOverrides: record.attributeOverrides,
          versionId: childPin ? record.version : undefined,
          versionNumber: childPin?.version,
          graph: resolved,
        });
      }
    }

    onPath.delete(pathKey);

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

/** Unpack a `GraphVersions` record into the form the assembler consumes. */
export function toPinnedGraph(version: GraphVersion): PinnedGraph | null {
  const snapshot = parseSnapshot(version.snapshot);
  if (!snapshot) return null;

  return {
    version: version.version,
    nodes: snapshotToNodes(snapshot, version.graph),
    imports: snapshotToImports(snapshot, version.graph),
  };
}

// ---------------------------------------------------------------------------
// The networked half
// ---------------------------------------------------------------------------

/** One entry on the loader's frontier: a graph, and the pin it arrived under. */
interface Frontier {
  graphId: string;
  /** The `GraphVersions` id this instance is pinned to, if any. */
  versionId?: string;
}

/**
 * Breadth-first load, one batch of requests per depth level.
 *
 * Memoized across levels — by graph id for a live instance, by version id for a
 * pinned one — so a diamond loads its shared child once and a cycle in a
 * malformed database cannot make the loader spin. Disabled imports are loaded
 * but not descended into: the assembler needs the rows to report them.
 *
 * The two kinds of frontier entry differ in where their contents come from. A
 * live one needs a round trip for its nodes and imports; a pinned one already
 * has both inside its snapshot, so it costs one `GraphVersions` read per
 * *version*, not per import. Both still need the child `Graphs` records, since
 * a snapshot stores child ids rather than child graphs.
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
  const versionMutator = new GraphVersionMutator(pb);

  const data: ResolvedGraphData = {
    graphs: new Map(),
    importsByParent: new Map(),
    nodesByGraph: new Map(),
    pins: new Map(),
  };

  const root = await graphMutator.getById(rootId);
  // An unreadable root leaves the map empty; the assembler reports it, so
  // there is one place that decides what a missing graph means.
  if (!root) return data;
  data.graphs.set(root.id, root);

  // The root is never pinned: you are looking at it, not importing it.
  let level: Frontier[] = [{ graphId: root.id }];
  const seen = new Set<string>([root.id]);
  let depth = 1;

  // `depth <= maxDepth` deliberately loads one level of *graph records* beyond
  // the limit (never their nodes). Without it the assembler could not tell
  // "the tree ends here" from "the tree was cut off here", and the
  // `resolution-truncated` diagnostic would never fire.
  while (level.length && depth <= maxDepth) {
    const liveIds = level
      .filter((entry) => !entry.versionId)
      .map((entry) => entry.graphId);

    const [imports, nodes] = await Promise.all([
      importMutator.listForParents(liveIds),
      nodeMutator.listForGraphs(liveIds),
    ]);

    for (const graphId of liveIds) {
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

    // Imports declared by this level: live rows for live entries, snapshot rows
    // for pinned ones. Both feed the same "what do we load next?" question.
    const declared: GraphImport[] = [...imports];
    for (const entry of level) {
      if (!entry.versionId) continue;
      const pin = data.pins.get(entry.versionId);
      if (pin) declared.push(...pin.imports);
    }

    const enabled = declared.filter((record) => record.enabled);

    const wantedGraphs = [
      ...new Set(
        enabled
          .map((record) => record.child)
          .filter((id) => !data.graphs.has(id))
      ),
    ];
    const wantedVersions = [
      ...new Set(
        enabled
          .map((record) => record.version)
          .filter((id): id is string => Boolean(id))
      ),
    ].filter((id) => !data.pins.has(id));

    const [children, versions] = await Promise.all([
      graphMutator.listByIds(wantedGraphs),
      versionMutator.listByIds(wantedVersions),
    ]);

    for (const child of children) data.graphs.set(child.id, child);
    for (const version of versions) {
      const unpacked = toPinnedGraph(version);
      // A snapshot that will not parse is treated exactly like one that could
      // not be read: the assembler reports it and falls back to live.
      if (unpacked) data.pins.set(version.id, unpacked);
    }

    // Ids we asked for and did not get back were filtered out by the read
    // rules — deleted, or flipped to private since the import was recorded.
    // The assembler turns that into a `child-unreadable` diagnostic in place.
    const readable = new Set(children.map((child) => child.id));

    const next: Frontier[] = [];
    for (const record of enabled) {
      if (!data.graphs.has(record.child)) continue;
      // Only descend into children fetched on *this* pass; one already in the
      // map was expanded on an earlier level.
      const pin = record.version ? data.pins.get(record.version) : undefined;
      const key = pin ? `${record.child}@${record.version}` : record.child;
      if (!pin && !readable.has(record.child)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({
        graphId: record.child,
        versionId: pin ? record.version : undefined,
      });
    }

    level = next;
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
