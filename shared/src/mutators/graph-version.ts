import { RecordService } from 'pocketbase';
import {
  formatVersion,
  type GraphVersion,
  type GraphVersionInput,
  GraphVersionInputSchema,
} from '../schema/graph-version';
import {
  parseSnapshot,
  serializeGraph,
  snapshotMatches,
} from '../lib/graph/snapshot';
import type { Graph } from '../schema/graph';
import type { GraphImport } from '../schema/graph-import';
import type { GraphNode } from '../schema/graph-node';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { GraphImportMutator } from './graph-import';
import { GraphNodeMutator } from './graph-node';

export class GraphVersionMutator extends BaseMutator<
  GraphVersion,
  GraphVersionInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<GraphVersion> {
    return this.pb.collection('GraphVersions');
  }

  protected setDefaults(): MutatorOptions {
    // Newest first: every list of versions is read newest-down.
    return { expand: [], filter: [], sort: ['-version'] };
  }

  protected async validateInput(
    input: GraphVersionInput
  ): Promise<GraphVersionInput> {
    return GraphVersionInputSchema.parse(input);
  }

  /** A graph's versions, newest first. */
  async listForGraph(graphId: string, page = 1, perPage = 100) {
    return await this.getList(page, perPage, `graph = "${graphId}"`);
  }

  /** The highest-numbered version of a graph, or `null` if never published. */
  async latestForGraph(graphId: string): Promise<GraphVersion | null> {
    return await this.getFirstByFilter(
      `graph = "${graphId}"`,
      undefined,
      '-version'
    );
  }

  /**
   * Several versions by id in one request — what the resolver uses to load the
   * snapshots behind a tree's pinned imports.
   *
   * Ids that come back missing were filtered out by the read rules or deleted;
   * the resolver reports those as `version-unreadable` and falls back to live.
   */
  async listByIds(ids: readonly string[]): Promise<GraphVersion[]> {
    if (!ids.length) return [];

    const filter = ids.map((id) => `id = "${id}"`).join(' || ');
    return await this.getCollection().getFullList({ filter, sort: 'id' });
  }

  /**
   * Take a snapshot of a graph as it currently stands.
   *
   * The version number is allocated by reading the current maximum and adding
   * one. PocketBase has no sequences, so two publishes racing each other both
   * pick the same number and the loser hits the `UNIQUE (graph, version)`
   * index — a 400 rather than two versions silently sharing a number, which is
   * the failure mode worth having.
   *
   * Returns the existing latest version unchanged when nothing has moved since
   * it was taken. Publishing twice in a row should not mint `v4` identical to
   * `v3`; a version list that grows without the graph changing is noise a
   * pinned importer then has to read through.
   */
  async publish(
    graph: Graph,
    nodes: readonly GraphNode[],
    imports: readonly GraphImport[],
    note?: string
  ): Promise<GraphVersion> {
    const userId = this.pb.authStore.record?.id;
    if (!userId) {
      throw new Error('Cannot publish a version while signed out');
    }

    const latest = await this.latestForGraph(graph.id);
    if (latest && snapshotMatches(latest.snapshot, graph, nodes, imports)) {
      return latest;
    }

    return await this.create({
      graph: graph.id,
      version: (latest?.version ?? 0) + 1,
      snapshot: serializeGraph(graph, nodes, imports),
      note,
      createdBy: userId,
    });
  }

  /**
   * Put a snapshot back, replacing the graph's current nodes and imports.
   *
   * Takes a version of the *current* state first, so a restore is undoable —
   * that is the "before a destructive edit" half of what versions are for, and
   * this is the most destructive edit there is.
   *
   * Nodes are matched by **record id**, not recreated: a restored node keeps
   * the id every instance path and `GraphEdgeOverride` on every importing graph
   * addresses it by. Recreating them would restore the picture and quietly
   * break every parent that had corrected its wiring.
   *
   * Not atomic — PocketBase has no multi-record transaction — so the order is
   * chosen to fail safely: writes first, deletions last.
   */
  async restore(
    graph: Graph,
    version: GraphVersion,
    current: { nodes: readonly GraphNode[]; imports: readonly GraphImport[] }
  ): Promise<void> {
    const snapshot = parseSnapshot(version.snapshot);
    if (!snapshot) {
      throw new Error(
        `${formatVersion(version)} could not be read; it may have been written by a newer version of graph-ware.`
      );
    }

    await this.publish(
      graph,
      current.nodes,
      current.imports,
      `Automatic snapshot before restoring ${formatVersion(version)}`
    );

    const nodes = new GraphNodeMutator(this.pb);
    const imports = new GraphImportMutator(this.pb);

    const liveNodes = new Map(current.nodes.map((node) => [node.id, node]));
    for (const node of snapshot.nodes) {
      const payload = {
        graph: graph.id,
        name: node.name,
        label: node.label,
        attributes: node.attributes ?? [],
        ports: node.ports ?? [],
        position: node.position,
      };

      if (liveNodes.has(node.id)) await nodes.update(node.id, payload);
      else await nodes.create(payload);
    }

    const liveImports = new Map(current.imports.map((row) => [row.id, row]));
    for (const record of snapshot.imports) {
      const payload = {
        parent: graph.id,
        child: record.child,
        alias: record.alias,
        label: record.label,
        order: record.order,
        enabled: record.enabled,
        version: record.version,
        attributeOverrides: record.attributeOverrides,
      };

      if (liveImports.has(record.id)) await imports.update(record.id, payload);
      else await imports.create(payload);
    }

    const keptNodes = new Set(snapshot.nodes.map((node) => node.id));
    for (const node of current.nodes) {
      if (!keptNodes.has(node.id)) await nodes.delete(node.id);
    }

    const keptImports = new Set(snapshot.imports.map((row) => row.id));
    for (const record of current.imports) {
      if (!keptImports.has(record.id)) await imports.delete(record.id);
    }
  }

  /**
   * How many versions of `graphId` are newer than `versionId`.
   *
   * This is the "3 newer versions available" badge on a pinned import. Counting
   * rather than listing, because the badge needs a number and the import panel
   * only loads the list when it is opened.
   */
  async countNewerThan(graphId: string, version: number): Promise<number> {
    const result = await this.getCollection().getList(1, 1, {
      filter: `graph = "${graphId}" && version > ${version}`,
    });
    return result.totalItems;
  }
}
