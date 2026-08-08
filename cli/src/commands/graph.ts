// Graph commands: the CRUD half plus fork.
import { cloneGraph } from '@project/shared/graph';
import {
  GRAPH_VISIBILITIES,
  type Graph,
  type GraphVisibility,
} from '@project/shared';
import { bool, str, type Command } from '../command.ts';
import { resolveGraph } from '../resolve-ref.ts';
import { isInteractive, promptLine } from '../prompt.ts';

const listColumns = [
  { header: 'UID', get: (g: Graph) => g.uid },
  { header: 'LABEL', get: (g: Graph) => g.label },
  { header: 'NAME', get: (g: Graph) => g.name },
  { header: 'NS', get: (g: Graph) => g.namespace ?? '' },
  { header: 'VIS', get: (g: Graph) => g.visibility },
  { header: 'ID', get: (g: Graph) => g.id ?? '' },
];

function visibility(value: string | undefined): GraphVisibility | undefined {
  if (value === undefined) return undefined;
  if (!GRAPH_VISIBILITIES.includes(value as GraphVisibility)) {
    throw new Error(
      `--visibility must be one of ${GRAPH_VISIBILITIES.join(', ')}, got "${value}"`
    );
  }
  return value as GraphVisibility;
}

export const ls: Command = {
  summary: 'List graphs',
  usage:
    'graphware graph ls [--mine] [--public] [--search <text>] [--tag <tag>]...',
  details:
    'Defaults to the active workspace. --search implies --public: the library\nsearch only covers graphs published for reuse.',
  options: {
    mine: { type: 'boolean' },
    public: { type: 'boolean' },
    search: { type: 'string' },
    tag: { type: 'string', multiple: true },
  },
  async run(ctx, args) {
    const search = str(args, 'search');
    const tags = (args.values.tag as string[] | undefined) ?? [];

    const result =
      search || tags.length
        ? await ctx.graphs.searchPublic({ text: search, tags })
        : bool(args, 'public')
          ? await ctx.graphs.listPublic()
          : bool(args, 'mine')
            ? await ctx.graphs.listMine()
            : await ctx.graphs.listForWorkspace(await ctx.workspaceId());

    // searchPublic pre-filters tags server-side with `~`, which matches
    // substrings — "power" would hit "powertrain". Narrow to exact here.
    const items = tags.length
      ? result.items.filter((graph) =>
          tags.every((tag) => (graph.tags ?? []).includes(tag))
        )
      : result.items;

    ctx.printer.list(items, listColumns, 'No graphs.');
  },
};

export const create: Command = {
  summary: 'Create a graph',
  usage:
    'graphware graph new --uid <uid> --name <machine_name> --label <label> [--namespace <ns>] [--visibility private|unlisted|public] [--description <text>]',
  options: {
    uid: { type: 'string' },
    name: { type: 'string' },
    label: { type: 'string' },
    namespace: { type: 'string' },
    visibility: { type: 'string' },
    description: { type: 'string' },
  },
  async run(ctx, args) {
    const uid = str(args, 'uid');
    const name = str(args, 'name');
    const label = str(args, 'label');
    if (!uid || !name || !label) {
      throw new Error('--uid, --name and --label are all required');
    }

    // `owner` is injected by the mutator; `workspace` is passed explicitly so
    // the active-workspace choice wins over the personal-workspace fallback.
    const graph = await ctx.graphs.create({
      uid,
      name,
      label,
      workspace: await ctx.workspaceId(),
      namespace: str(args, 'namespace'),
      description: str(args, 'description'),
      visibility: visibility(str(args, 'visibility')) ?? 'private',
    });

    ctx.printer.note(`Created ${graph.uid} (${graph.id})`);
    if (ctx.printer.json) ctx.printer.data(graph);
  },
};

export const show: Command = {
  summary: 'Show a graph with its nodes, imports and latest version',
  usage: 'graphware graph show <id|uid>',
  positionals: [{ name: 'id|uid', required: true }],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const [nodes, imports, latest, importers] = await Promise.all([
      ctx.nodes.listForGraph(graph.id!),
      ctx.imports.listForParent(graph.id!),
      ctx.versions.latestForGraph(graph.id!),
      ctx.graphs.countImporters(graph.id!),
    ]);

    if (ctx.printer.json) {
      ctx.printer.data({
        graph,
        nodes: nodes.items,
        imports: imports.items,
        latestVersion: latest,
        importerCount: importers,
      });
      return;
    }

    ctx.printer.detail(graph, [
      ['id', (g) => g.id ?? ''],
      ['uid', (g) => g.uid],
      ['name', (g) => g.name],
      ['label', (g) => g.label],
      ['namespace', (g) => g.namespace ?? ''],
      ['visibility', (g) => g.visibility],
      ['tags', (g) => (g.tags ?? []).join(', ')],
      ['description', (g) => g.description ?? ''],
      ['forkedFrom', (g) => g.forkedFrom ?? ''],
    ]);

    ctx.printer.line();
    ctx.printer.line(
      `${nodes.items.length} node(s), ${imports.items.length} import(s), ` +
        `imported by ${importers}` +
        (latest ? `, latest v${latest.version}` : ', never published')
    );
  },
};

export const set: Command = {
  summary: 'Update a graph',
  usage:
    'graphware graph set <id|uid> [--label <label>] [--name <name>] [--namespace <ns>] [--visibility <v>] [--description <text>]',
  positionals: [{ name: 'id|uid', required: true }],
  options: {
    label: { type: 'string' },
    name: { type: 'string' },
    namespace: { type: 'string' },
    visibility: { type: 'string' },
    description: { type: 'string' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);

    const patch: Partial<Graph> = {};
    if (str(args, 'label') !== undefined) patch.label = str(args, 'label');
    if (str(args, 'name') !== undefined) patch.name = str(args, 'name');
    if (str(args, 'namespace') !== undefined)
      patch.namespace = str(args, 'namespace');
    if (str(args, 'description') !== undefined)
      patch.description = str(args, 'description');
    const vis = visibility(str(args, 'visibility'));
    if (vis) patch.visibility = vis;

    if (Object.keys(patch).length === 0) {
      throw new Error('Nothing to change. Pass at least one field flag.');
    }

    const updated = await ctx.graphs.update(graph.id!, patch);
    ctx.printer.note(`Updated ${updated.uid}`);
    if (ctx.printer.json) ctx.printer.data(updated);
  },
};

export const rm: Command = {
  summary: 'Delete a graph',
  usage: 'graphware graph rm <id|uid> [--force]',
  details:
    'Refuses without --force when other graphs import this one, since deleting it\nbreaks their resolution.',
  positionals: [{ name: 'id|uid', required: true }],
  options: {
    force: { type: 'boolean' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const force = bool(args, 'force');
    const importers = await ctx.graphs.countImporters(graph.id!);

    if (importers > 0 && !force) {
      throw new Error(
        `${graph.uid} is imported by ${importers} graph(s); those imports will stop resolving. Re-run with --force.`
      );
    }

    // Confirm only where a human can answer. Under --json, or with no TTY,
    // the absence of --force above is the only guard — asking would hang.
    if (!force && isInteractive() && !ctx.printer.json) {
      const answer = await promptLine(`Delete ${graph.uid}? [y/N] `);
      if (!/^y(es)?$/i.test(answer)) {
        ctx.printer.note('Cancelled.');
        return 1;
      }
    }

    await ctx.graphs.delete(graph.id!);
    ctx.printer.note(`Deleted ${graph.uid}`);
    if (ctx.printer.json) ctx.printer.data({ id: graph.id, uid: graph.uid });
  },
};

export const fork: Command = {
  summary: 'Copy a graph into a workspace you can write',
  usage:
    'graphware graph fork <id|uid> [--into <slug|id>] [--deep] [--uid <uid>] [--label <label>] [--visibility <v>]',
  details:
    'A deep fork copies the whole import subtree, copying a multiply-imported\nchild once. Imports that point outside the copied set are left pointing at\nthe originals and are reported.',
  positionals: [{ name: 'id|uid', required: true }],
  options: {
    into: { type: 'string' },
    deep: { type: 'boolean' },
    uid: { type: 'string' },
    label: { type: 'string' },
    visibility: { type: 'string' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);

    const into = str(args, 'into');
    const workspace = into
      ? await ctx.lookupWorkspace(into)
      : await ctx.workspaceId();
    if (!workspace) throw new Error(`No workspace "${into}" that you can see.`);

    const result = await cloneGraph(ctx.pb, graph.id!, {
      workspace,
      deep: bool(args, 'deep'),
      uid: str(args, 'uid'),
      label: str(args, 'label'),
      visibility: visibility(str(args, 'visibility')),
    });

    if (ctx.printer.json) {
      ctx.printer.data({
        graph: result.graph,
        copies: Object.fromEntries(result.copies),
        external: result.external,
      });
      return;
    }

    ctx.printer.note(
      `Forked ${graph.uid} → ${result.graph.uid} (${result.copies.size} graph(s) copied)`
    );
    // Always surfaced, never only under a verbose flag: an import still
    // pointing at someone else's graph is the surprising half of a fork.
    if (result.external.length) {
      ctx.printer.warn(
        `${result.external.length} import(s) still point at the original graphs: ` +
          result.external.map((i) => i.alias).join(', ')
      );
    }
  },
};

export const forks: Command = {
  summary: 'List graphs forked from this one',
  usage: 'graphware graph forks <id|uid>',
  positionals: [{ name: 'id|uid', required: true }],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const result = await ctx.graphs.listForks(graph.id!);
    ctx.printer.list(result.items, listColumns, 'No forks.');
  },
};

export const importers: Command = {
  summary: 'List graphs that import this one',
  usage: 'graphware graph importers <id|uid>',
  positionals: [{ name: 'id|uid', required: true }],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const result = await ctx.imports.listImporters(graph.id!);
    ctx.printer.list(
      result.items,
      [
        { header: 'ALIAS', get: (i) => i.alias },
        {
          header: 'PARENT',
          get: (i) =>
            (i.expand as { parent?: Graph } | undefined)?.parent?.uid ??
            i.parent,
        },
        { header: 'IMPORT ID', get: (i) => i.id ?? '' },
      ],
      'Nothing imports this graph.'
    );
  },
};
