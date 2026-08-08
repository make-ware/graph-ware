// Version commands.
//
// A version is a whole-graph JSON snapshot, one level deep: nodes and imports
// by record id, so a pinned import still resolves its own children live.
import {
  formatVersion,
  parseSnapshot,
  type GraphVersion,
} from '@project/shared';
import { str, type Command } from '../command.ts';
import { resolveGraph, resolveVersion } from '../resolve-ref.ts';

const columns = [
  {
    header: 'VERSION',
    get: (v: GraphVersion) => formatVersion(v),
    align: 'right' as const,
  },
  { header: 'NOTE', get: (v: GraphVersion) => v.note ?? '' },
  { header: 'CREATED', get: (v: GraphVersion) => v.created ?? '' },
  { header: 'ID', get: (v: GraphVersion) => v.id ?? '' },
];

export const ls: Command = {
  summary: 'List the published versions of a graph',
  usage: 'graphware version ls <graph>',
  positionals: [{ name: 'graph', required: true }],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const result = await ctx.versions.listForGraph(graph.id!);
    ctx.printer.list(result.items, columns, 'Never published.');
  },
};

export const show: Command = {
  summary: 'Show a version and its snapshot',
  usage: 'graphware version show <graph> <version|versionId>',
  positionals: [
    { name: 'graph', required: true },
    { name: 'version', required: true },
  ],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const version = await resolveVersion(ctx, graph.id!, args.positionals[1]);

    const snapshot = parseSnapshot(version.snapshot);
    if (!snapshot) {
      throw new Error(
        `${formatVersion(version)} could not be read; it may have been written by a newer version of graph-ware.`
      );
    }

    if (ctx.printer.json) {
      ctx.printer.data({ ...version, snapshot });
      return;
    }

    ctx.printer.detail(version, [
      ['version', (v) => formatVersion(v)],
      ['id', (v) => v.id ?? ''],
      ['note', (v) => v.note ?? ''],
      ['created', (v) => v.created ?? ''],
    ]);
    ctx.printer.line();
    ctx.printer.line(
      `${snapshot.nodes.length} node(s), ${snapshot.imports.length} import(s)`
    );
  },
};

export const publish: Command = {
  summary: 'Publish the current state as a new version',
  usage: 'graphware version publish <graph> [--note <text>]',
  details:
    'A no-op when nothing changed since the last version: the existing one is\nreturned rather than a duplicate minted, and the output says so.',
  positionals: [{ name: 'graph', required: true }],
  options: {
    note: { type: 'string' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const [nodes, imports, before] = await Promise.all([
      ctx.nodes.listForGraph(graph.id!),
      ctx.imports.listForParent(graph.id!),
      ctx.versions.latestForGraph(graph.id!),
    ]);

    const version = await ctx.versions.publish(
      graph,
      nodes.items,
      imports.items,
      str(args, 'note')
    );

    // publish() returns the existing latest when the snapshot matches. Saying
    // "published v3" when v3 already existed would be a lie the caller acts on.
    const unchanged = before?.id === version.id;
    ctx.printer.note(
      unchanged
        ? `No changes since ${formatVersion(version)}; nothing published.`
        : `Published ${formatVersion(version)} of ${graph.uid}`
    );
    if (ctx.printer.json) ctx.printer.data({ ...version, unchanged });
  },
};

export const restore: Command = {
  summary: 'Restore a graph to a published version',
  usage: 'graphware version restore <graph> <version|versionId>',
  details:
    'Publishes the current state first, so a restore is always undoable. Nodes\nare matched by record id; ones the snapshot does not contain are deleted.',
  positionals: [
    { name: 'graph', required: true },
    { name: 'version', required: true },
  ],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const version = await resolveVersion(ctx, graph.id!, args.positionals[1]);

    const [nodes, imports] = await Promise.all([
      ctx.nodes.listForGraph(graph.id!),
      ctx.imports.listForParent(graph.id!),
    ]);

    await ctx.versions.restore(graph, version, {
      nodes: nodes.items,
      imports: imports.items,
    });

    ctx.printer.note(
      `Restored ${graph.uid} to ${formatVersion(version)}. The previous state was published first.`
    );
    if (ctx.printer.json) {
      ctx.printer.data({ graph: graph.id, restoredTo: version.id });
    }
  },
};
