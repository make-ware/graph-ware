// Serializing a graph into a version snapshot, and putting one back.
//
// Split the same way `resolver.ts` is: `serializeGraph` and `snapshotToRecords`
// are pure and take plain records, `publishSnapshot` and `restoreSnapshot` take
// a PocketBase client. The pure half is what the tests exercise, and it is what
// the resolver calls when it renders a pinned import.
//
// Reference: docs/DATA_MODEL.md § Versions

import {
  GRAPH_SNAPSHOT_FORMAT,
  GraphSnapshotSchema,
  type GraphSnapshot,
  type SnapshotImport,
} from './primitives';
import type { Graph } from '../../schema/graph';
import type { GraphImport } from '../../schema/graph-import';
import type { GraphNode } from '../../schema/graph-node';

/**
 * Freeze a graph's stored form into a snapshot payload.
 *
 * One level deep, deliberately: the graph's own nodes and its own import rows,
 * not the graphs those imports name. See `GraphSnapshotSchema` for why.
 */
export function serializeGraph(
  graph: Graph,
  nodes: readonly GraphNode[],
  imports: readonly GraphImport[]
): GraphSnapshot {
  return {
    format: GRAPH_SNAPSHOT_FORMAT,
    graph: {
      uid: graph.uid,
      name: graph.name,
      label: graph.label,
      namespace: graph.namespace || undefined,
      description: graph.description || undefined,
      tags: graph.tags?.length ? [...graph.tags] : undefined,
    },
    // Deterministic order, so two snapshots of an unchanged graph are byte
    // identical and "has anything changed since v3?" is a string comparison.
    nodes: [...nodes]
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map((node) => ({
        id: node.id,
        name: node.name,
        label: node.label,
        attributes: node.attributes?.length ? node.attributes : undefined,
        ports: node.ports?.length ? node.ports : undefined,
        position: node.position ?? undefined,
      })),
    imports: [...imports]
      .sort(
        (left, right) =>
          left.order - right.order || (left.alias < right.alias ? -1 : 1)
      )
      .map((record) => ({
        id: record.id,
        child: record.child,
        alias: record.alias,
        label: record.label || undefined,
        order: record.order,
        enabled: record.enabled !== false,
        version: record.version || undefined,
        attributeOverrides: record.attributeOverrides ?? undefined,
      })),
  };
}

/**
 * Read a snapshot back off a `GraphVersions` record.
 *
 * Returns `null` rather than throwing when the payload is malformed or was
 * written by a newer format: a bad snapshot should cost one import its pin and
 * a diagnostic, not the whole render.
 */
export function parseSnapshot(value: unknown): GraphSnapshot | null {
  const parsed = GraphSnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.format > GRAPH_SNAPSHOT_FORMAT) return null;
  return parsed.data;
}

/**
 * Present a snapshot's nodes as `GraphNodes` records for the resolver.
 *
 * The resolver and engine are typed on records, and a snapshot deliberately
 * stores no `created`/`updated`/`graph` — those describe the live row, not the
 * frozen picture. They are filled in from the graph being rendered so the
 * shapes line up; nothing downstream reads them.
 *
 * **The record ids are the originals.** That is what keeps a parent's
 * `GraphEdgeOverrides` matching across a pin: an override addresses
 * `port_bank/NODEID`, and pinning must not change what `NODEID` is.
 */
export function snapshotToNodes(
  snapshot: GraphSnapshot,
  graphId: string
): GraphNode[] {
  return snapshot.nodes.map((node) => ({
    id: node.id,
    graph: graphId,
    name: node.name,
    label: node.label,
    attributes: node.attributes,
    ports: node.ports,
    position: node.position,
    created: '',
    updated: '',
  })) as GraphNode[];
}

/** The same, for a snapshot's import rows. */
export function snapshotToImports(
  snapshot: GraphSnapshot,
  graphId: string
): GraphImport[] {
  return snapshot.imports.map((record: SnapshotImport) => ({
    id: record.id,
    parent: graphId,
    child: record.child,
    alias: record.alias,
    label: record.label,
    order: record.order,
    enabled: record.enabled,
    version: record.version,
    attributeOverrides: record.attributeOverrides,
    created: '',
    updated: '',
  })) as GraphImport[];
}

/**
 * `JSON.stringify` with object keys sorted, recursively.
 *
 * **Required, not tidiness.** PocketBase stores a JSON field by marshalling it
 * in Go, which sorts map keys alphabetically — so a snapshot that comes back
 * off a record has a different key order from the one `serializeGraph` just
 * produced, however identical the data. A plain `JSON.stringify` comparison
 * between the two therefore never matches, and "has anything changed since v3?"
 * silently answers yes forever: every publish mints a version, and the check
 * that exists to prevent that never fires.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` has no JSON representation; dropping it here matches what
      // `JSON.stringify` would have done with the key.
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

/**
 * Does a snapshot still describe the graph as it stands?
 *
 * Used to decide whether "publish" has anything to publish, and to tell a
 * pinned importer that the child has actually moved rather than merely been
 * saved. Absent-vs-empty is normalized by `serializeGraph`; key order is
 * normalized here, because one side of this comparison has been through
 * PocketBase and the other has not.
 */
export function snapshotMatches(
  snapshot: GraphSnapshot,
  graph: Graph,
  nodes: readonly GraphNode[],
  imports: readonly GraphImport[]
): boolean {
  return (
    canonicalJson(snapshot) ===
    canonicalJson(serializeGraph(graph, nodes, imports))
  );
}
