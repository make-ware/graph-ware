// Version commands.
//
// A version is a whole-graph JSON snapshot, one level deep: nodes and imports
// by record id, so a pinned import still resolves its own children live.
import type { Command } from 'commander';
import {
  formatVersion,
  parseSnapshot,
  type GraphVersion,
} from '@project/shared';
import type { Ctx } from '../context.ts';
import { addListOptions, fetchList, type ListOpts } from '../listing.ts';
import { resolveGraph, resolveVersion } from '../resolve-ref.ts';
import type { Runtime } from '../runtime.ts';

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

export async function ls(ctx: Ctx, opts: ListOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const result = await fetchList(ctx.versions, `graph = "${graph.id}"`, opts);
  ctx.printer.list(result, columns, 'Never published.');
}

export async function show(
  ctx: Ctx,
  _opts: unknown,
  graphRef: string,
  versionRef: string
) {
  const graph = await resolveGraph(ctx, graphRef);
  const version = await resolveVersion(ctx, graph.id!, versionRef);

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
}

export async function publish(ctx: Ctx, opts: { note?: string }, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const [nodes, imports, before] = await Promise.all([
    ctx.nodes.listForGraph(graph.id!),
    ctx.imports.listForParent(graph.id!),
    ctx.versions.latestForGraph(graph.id!),
  ]);

  const version = await ctx.versions.publish(
    graph,
    nodes.items,
    imports.items,
    opts.note
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
}

export async function restore(
  ctx: Ctx,
  _opts: unknown,
  graphRef: string,
  versionRef: string
) {
  const graph = await resolveGraph(ctx, graphRef);
  const version = await resolveVersion(ctx, graph.id!, versionRef);

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
}

export function registerVersion(program: Command, rt: Runtime): void {
  const version = program
    .command('version')
    .summary('published snapshots')
    .description(
      'Published snapshots.\n\n' +
        'Publishing freezes the current nodes and imports as an immutable,\n' +
        'numbered snapshot. Versions are what imports pin to, and what restore\n' +
        'rolls back to. Reference one by its number (3, v3) or record id.'
    );

  addListOptions(
    version
      .command('ls')
      .summary('list the published versions of a graph')
      .description('List the published versions of a graph, newest first.')
      .argument('<graph>', 'the graph (id or uid)')
  ).action(rt.act(ls));

  version
    .command('show')
    .summary('show a version and its snapshot')
    .description('Show a version, and under --json its full snapshot.')
    .argument('<graph>', 'the graph (id or uid)')
    .argument('<version>', 'version number (3, v3) or record id')
    .action(rt.act(show));

  version
    .command('publish')
    .summary('publish the current state as a new version')
    .description(
      'Publish the current state as a new version.\n\n' +
        'A no-op when nothing changed since the last version: the existing one is\n' +
        'returned rather than a duplicate minted, and the output says so.'
    )
    .argument('<graph>', 'the graph (id or uid)')
    .option('--note <text>', 'what this version is')
    .action(rt.act(publish));

  version
    .command('restore')
    .summary('restore a graph to a published version')
    .description(
      'Restore a graph to a published version.\n\n' +
        'Publishes the current state first, so a restore is always undoable. Nodes\n' +
        'are matched by record id; ones the snapshot does not contain are deleted.'
    )
    .argument('<graph>', 'the graph (id or uid)')
    .argument('<version>', 'version number (3, v3) or record id')
    .action(rt.act(restore));
}
