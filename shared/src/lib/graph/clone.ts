// Forking a graph — copying it, and optionally its whole import subtree, into a
// workspace you can write.
//
// Networked, like `resolver.ts`, so it is kept out of the bare `@project/shared`
// barrel and reached through `@project/shared/graph`; the *planning* half is
// pure and exported so tests can assert what a fork would do without a server.
//
// The shape of the thing worth getting right: a deep fork copies each graph in
// the subtree **once**, however many times it is imported, and rewires every
// import that named the original to name the copy. Forking `testDataElement`
// deeply produces one copy of `BatterySystem` with `port_bank` and
// `starboard_bank` both pointing at it — not two copies, which would turn one
// shared component into two that drift apart on the first edit.
//
// Reference: docs/IMPORTS.md § Forking

import { collectDescendants, type ImportEdge } from './imports';
import { MAX_IMPORT_DEPTH } from './primitives';
import type { Graph } from '../../schema/graph';
import type { GraphImport } from '../../schema/graph-import';
import type { GraphNode } from '../../schema/graph-node';
import { GraphEdgeOverrideMutator } from '../../mutators/graph-edge-override';
import { GraphImportMutator } from '../../mutators/graph-import';
import { GraphMutator } from '../../mutators/graph';
import { GraphNodeMutator } from '../../mutators/graph-node';
import type { TypedPocketBase } from '../../types';

export interface CloneOptions {
  /** Where the copies go. Required: a fork always lands somewhere explicit. */
  workspace: string;
  /** Copy the whole import subtree, not just the root graph. */
  deep?: boolean;
  /** `uid` for the copy. Defaults to the source's uid with `-copy` appended. */
  uid?: string;
  /** Label for the copy. Defaults to the source's label plus " (fork)". */
  label?: string;
  /** Visibility for every copy. Defaults to `private`. */
  visibility?: Graph['visibility'];
}

/** What a fork is about to copy, decided before anything is written. */
export interface ClonePlan {
  /** Source graph ids to copy, root first, then descendants in a stable order. */
  sources: string[];
  /** The same set, for membership tests. */
  copied: Set<string>;
}

/** Import rows split by whether their child is being copied too. */
export interface PartitionedImports {
  /** Rewired to point at the copy. */
  internal: GraphImport[];
  /** Left pointing at the original graph. */
  external: GraphImport[];
}

export interface CloneResult {
  /** The copy of the graph that was forked. */
  graph: Graph;
  /** Source graph id → copy id, for every graph copied. */
  copies: Map<string, string>;
  /**
   * Imports that were left pointing at the original graph rather than a copy.
   *
   * A shallow fork leaves all of them; a deep fork leaves the ones that were
   * unreadable at plan time. Either way the caller is told, because "your fork
   * still depends on somebody else's graph" is not a detail to discover later.
   */
  external: GraphImport[];
}

/**
 * Decide what a fork copies, without writing anything.
 *
 * Depth is checked against the same `MAX_IMPORT_DEPTH` the import guard uses,
 * on the same edge list — a deep fork walks exactly the graph the resolver
 * does, so it inherits the same cycle and depth risks and must not grow a
 * second traversal with its own opinions.
 */
export function planClone(
  rootId: string,
  edges: readonly ImportEdge[],
  options: { deep?: boolean } = {}
): ClonePlan {
  const copied = new Set<string>([rootId]);

  if (options.deep) {
    // A set, so a graph imported twice — or reached down two branches of a
    // diamond — is copied once and both imports are rewired to that one copy.
    for (const id of collectDescendants(rootId, edges)) copied.add(id);
  }

  // Root first, then the rest in id order. Deterministic, and the root's copy
  // is the one handed back, so it should not depend on traversal luck.
  const sources = [rootId, ...[...copied].filter((id) => id !== rootId).sort()];

  return { sources, copied };
}

/**
 * Split a set of import rows by whether their child is inside the fork.
 *
 * A shallow fork puts every row in `external`: the copy imports the *originals*,
 * which is what makes a shallow fork cheap and what makes it still depend on
 * somebody else's graphs.
 */
export function partitionImports(
  copied: ReadonlySet<string>,
  imports: readonly GraphImport[]
): PartitionedImports {
  const relevant = imports.filter((record) => copied.has(record.parent));

  return {
    internal: relevant.filter((record) => copied.has(record.child)),
    external: relevant.filter((record) => !copied.has(record.child)),
  };
}

/**
 * How deep the subtree under `rootId` runs, counting graphs including the root.
 *
 * A deep fork of a subtree that already exceeds the limit would produce a copy
 * nobody can resolve, so it is refused up front rather than half-written.
 */
export function cloneDepth(
  rootId: string,
  edges: readonly ImportEdge[]
): number {
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = children.get(edge.parent);
    if (existing) existing.push(edge.child);
    else children.set(edge.parent, [edge.child]);
  }

  const measure = (id: string, onPath: Set<string>): number => {
    if (onPath.has(id)) return 0;
    onPath.add(id);

    let deepest = 0;
    for (const child of children.get(id) ?? []) {
      deepest = Math.max(deepest, measure(child, onPath));
    }

    onPath.delete(id);
    return deepest + 1;
  };

  return measure(rootId, new Set());
}

/** `BatterySystem` → `BatterySystem-copy`, `…-copy-2`, `…-copy-3`. */
export function forkedUid(uid: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${uid}-copy`.slice(0, 64);

  if (!used.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`.slice(0, 64);
    if (!used.has(candidate)) return candidate;
  }

  return `${uid.slice(0, 50)}-${Date.now()}`.slice(0, 64);
}

/**
 * Copy a graph — and optionally everything it imports — into a workspace.
 *
 * Not atomic, because PocketBase has no multi-record transaction. The order is
 * chosen so that a failure partway leaves something coherent rather than
 * something broken: every graph and its nodes first, then the imports that
 * connect them. A fork that dies halfway is a set of disconnected copies, which
 * a user can delete; the reverse order would leave imports pointing at graphs
 * that do not exist.
 */
export async function cloneGraph(
  pb: TypedPocketBase,
  rootId: string,
  options: CloneOptions
): Promise<CloneResult> {
  const graphs = new GraphMutator(pb);
  const nodes = new GraphNodeMutator(pb);
  const importMutator = new GraphImportMutator(pb);

  const edges = await importMutator.listAllEdges();

  if (options.deep && cloneDepth(rootId, edges) > MAX_IMPORT_DEPTH) {
    throw new Error(
      `That graph's imports nest deeper than ${MAX_IMPORT_DEPTH}; the copy could not be resolved.`
    );
  }

  const plan = planClone(rootId, edges, { deep: options.deep });

  const sources = await graphs.listByIds(plan.sources);
  const sourceById = new Map(sources.map((graph) => [graph.id, graph]));

  if (!sourceById.has(rootId)) {
    throw new Error('That graph could not be read, so it cannot be forked.');
  }

  // Re-partitioned against the graphs that were actually *readable*, not the
  // ones the edge list named: a descendant the caller cannot read is not a
  // failure, it just stays external and the copy keeps importing the original.
  const readable = new Set(sourceById.keys());
  const { internal, external } = partitionImports(
    readable,
    await importMutator.listForParents([...readable])
  );

  // uids are unique per (workspace, namespace), so the copies have to avoid the
  // uids already in the destination workspace.
  const destination = await graphs.listForWorkspace(options.workspace);
  const taken = new Set(destination.items.map((graph) => graph.uid));

  const copies = new Map<string, string>();

  for (const id of plan.sources) {
    const source = sourceById.get(id);
    if (!source) continue;

    const isRoot = id === rootId;
    const uid = isRoot
      ? (options.uid ?? forkedUid(source.uid, taken))
      : forkedUid(source.uid, taken);
    taken.add(uid);

    const copy = await graphs.create({
      workspace: options.workspace,
      forkedFrom: source.id,
      uid,
      name: source.name,
      label: isRoot
        ? (options.label ?? `${source.label} (fork)`)
        : source.label,
      namespace: source.namespace,
      description: source.description,
      visibility: options.visibility ?? 'private',
      // `?? undefined` throughout, and it is not decoration: PocketBase returns
      // **null** for an unset optional JSON field, while the zod input schemas
      // declare those fields `.optional()` — which accepts `undefined` and
      // rejects `null`. Passing a record's own values straight back into a
      // create is exactly where the two conventions meet.
      tags: source.tags ?? undefined,
    });
    copies.set(source.id, copy.id);

    const sourceNodes = await nodes.listForGraph(source.id);
    for (const node of sourceNodes.items) {
      await nodes.create({
        graph: copy.id,
        name: node.name,
        label: node.label,
        attributes: node.attributes ?? undefined,
        ports: node.ports ?? undefined,
        position: node.position ?? undefined,
      });
    }
  }

  // Imports last, and only once every copy exists — an import naming a graph
  // that is not there yet fails the create rule's readability check.
  for (const record of internal) {
    const parent = copies.get(record.parent);
    const child = copies.get(record.child);
    if (!parent || !child) continue;

    await importMutator.create({
      parent,
      child,
      alias: record.alias,
      label: record.label,
      order: record.order,
      enabled: record.enabled !== false,
      // The pin is preserved deliberately: a fork of a system that depended on
      // `v3` of a component still depends on `v3` of it. The pin points at the
      // *original's* version, which is fine — versions are readable wherever
      // their graph is.
      version: record.version || undefined,
      attributeOverrides: record.attributeOverrides ?? undefined,
    });
  }

  // A shallow fork keeps its imports pointing at the originals, so the aliases
  // are unchanged and the root's overrides still address the same paths.
  for (const record of external) {
    const parent = copies.get(record.parent);
    if (!parent) continue;

    await importMutator.create({
      parent,
      child: record.child,
      alias: record.alias,
      label: record.label,
      order: record.order,
      enabled: record.enabled !== false,
      version: record.version || undefined,
      attributeOverrides: record.attributeOverrides ?? undefined,
    });
  }

  const rootCopy = copies.get(rootId);
  if (!rootCopy) {
    throw new Error('The fork could not be created.');
  }

  await copyRootOverrides(pb, rootId, rootCopy);

  const graph = await graphs.getById(rootCopy);
  if (!graph) {
    throw new Error('The fork was created but could not be read back.');
  }

  return { graph, copies, external };
}

/**
 * Carry the root graph's edge overrides across to its copy.
 *
 * Overrides address endpoints by instance path, and an instance path ends in a
 * `GraphNodes` **record id** — which a copy does not share. Node *names* are
 * unique within a graph, so a root-graph override can be translated through
 * them; an override reaching into an imported subtree cannot, because the copy
 * of that subtree has new ids all the way down.
 *
 * So: root-to-root overrides are translated, deeper ones are dropped. Dropping
 * is the honest outcome — a copied override that matched nothing would show up
 * as a `stale-override` warning on a graph the user has not touched yet.
 * Documented in docs/IMPORTS.md § Forking.
 */
async function copyRootOverrides(
  pb: TypedPocketBase,
  sourceId: string,
  copyId: string
): Promise<void> {
  const overrides = new GraphEdgeOverrideMutator(pb);
  const nodes = new GraphNodeMutator(pb);

  const [stored, sourceNodes, copiedNodes] = await Promise.all([
    overrides.listForGraph(sourceId),
    nodes.listForGraph(sourceId),
    nodes.listForGraph(copyId),
  ]);

  if (!stored.length) return;

  const nameById = new Map(
    sourceNodes.items.map((node: GraphNode) => [node.id, node.name])
  );
  const idByName = new Map(
    copiedNodes.items.map((node: GraphNode) => [node.name, node.id])
  );

  const translate = (path: string): string | null => {
    const name = nameById.get(path);
    return name ? (idByName.get(name) ?? null) : null;
  };

  for (const override of stored) {
    const sourcePath = translate(override.sourcePath);
    const targetPath = translate(override.targetPath);
    if (!sourcePath || !targetPath) continue;

    await overrides.create({
      graph: copyId,
      mode: override.mode,
      sourcePath,
      sourcePort: override.sourcePort,
      targetPath,
      targetPort: override.targetPort,
      reason: override.reason || undefined,
    });
  }
}
