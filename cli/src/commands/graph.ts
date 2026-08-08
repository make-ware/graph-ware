// Graph commands: the CRUD half plus fork.
import { Option, type Command } from 'commander';
import { cloneGraph } from '@project/shared/graph';
import { GRAPH_VISIBILITIES, type Graph } from '@project/shared';
import type { Ctx } from '../context.ts';
import { addListOptions, fetchList, type ListOpts } from '../listing.ts';
import { ask, canPrompt } from '../prompt.ts';
import { resolveGraph } from '../resolve-ref.ts';
import type { Runtime } from '../runtime.ts';

const listColumns = [
  { header: 'UID', get: (g: Graph) => g.uid },
  { header: 'LABEL', get: (g: Graph) => g.label },
  { header: 'NAME', get: (g: Graph) => g.name },
  { header: 'NS', get: (g: Graph) => g.namespace ?? '' },
  { header: 'VIS', get: (g: Graph) => g.visibility },
  { header: 'ID', get: (g: Graph) => g.id ?? '' },
];

const visibilityOption = (description: string) =>
  new Option('--visibility <v>', description).choices([...GRAPH_VISIBILITIES]);

/**
 * The library-search scope. Mirrors GraphMutator.searchPublic — the CLI builds
 * it locally so the standard --filter/--sort/--page flags compose with it —
 * **change one, change the other.** Tags use `~` (substring) here and are
 * narrowed to exact matches after the fetch, same as the webapp.
 */
function librarySearchScope(text: string | undefined, tags: readonly string[]) {
  const clauses = ['visibility = "public"'];

  const trimmed = text?.trim();
  if (trimmed) {
    const escaped = trimmed.replace(/"/g, '');
    clauses.push(
      `(label ~ "${escaped}" || name ~ "${escaped}" || uid ~ "${escaped}" || description ~ "${escaped}")`
    );
  }

  for (const tag of tags) {
    clauses.push(`tags ~ "${tag.replace(/"/g, '')}"`);
  }

  return clauses;
}

export interface GraphLsOpts extends ListOpts {
  mine?: boolean;
  public?: boolean;
  search?: string;
  tag?: string[];
}

export async function ls(ctx: Ctx, opts: GraphLsOpts) {
  const tags = opts.tag ?? [];
  const scope =
    opts.search || tags.length
      ? librarySearchScope(opts.search, tags)
      : opts.public
        ? ['visibility = "public"']
        : opts.mine
          ? [`owner = "${ctx.userId}"`]
          : [`workspace = "${await ctx.workspaceId()}"`];

  const result = await fetchList(ctx.graphs, scope, opts);

  // The tag scope pre-filters server-side with `~`, which matches substrings —
  // "power" would hit "powertrain". Narrow to exact here.
  const items = tags.length
    ? result.items.filter((graph) =>
        tags.every((tag) => (graph.tags ?? []).includes(tag))
      )
    : result.items;

  ctx.printer.list({ ...result, items }, listColumns, 'No graphs.');
}

export interface GraphCreateOpts {
  uid?: string;
  name?: string;
  label?: string;
  namespace?: string;
  visibility?: string;
  description?: string;
}

export async function create(ctx: Ctx, opts: GraphCreateOpts) {
  let { uid, name, label } = opts;
  if ((!uid || !name || !label) && canPrompt(ctx)) {
    uid =
      uid ?? (await ask.input({ message: 'UID (unique, e.g. LightSwitch):' }));
    label = label ?? (await ask.input({ message: 'Label (display name):' }));
    name =
      name ??
      (await ask.input({
        message: 'Machine name:',
        default: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      }));
  }
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
    namespace: opts.namespace,
    description: opts.description,
    visibility: (opts.visibility as Graph['visibility']) ?? 'private',
  });

  ctx.printer.note(`Created ${graph.uid} (${graph.id})`);
  if (ctx.printer.json) ctx.printer.data(graph);
}

export async function show(ctx: Ctx, _opts: unknown, ref: string) {
  const graph = await resolveGraph(ctx, ref);
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
}

export interface GraphSetOpts {
  label?: string;
  name?: string;
  namespace?: string;
  visibility?: string;
  description?: string;
}

export async function set(ctx: Ctx, opts: GraphSetOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);

  const patch: Partial<Graph> = {};
  if (opts.label !== undefined) patch.label = opts.label;
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.namespace !== undefined) patch.namespace = opts.namespace;
  if (opts.description !== undefined) patch.description = opts.description;
  if (opts.visibility !== undefined)
    patch.visibility = opts.visibility as Graph['visibility'];

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to change. Pass at least one field flag.');
  }

  const updated = await ctx.graphs.update(graph.id!, patch);
  ctx.printer.note(`Updated ${updated.uid}`);
  if (ctx.printer.json) ctx.printer.data(updated);
}

export interface GraphRmOpts {
  force?: boolean;
  yes?: boolean;
}

export async function rm(ctx: Ctx, opts: GraphRmOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const importers = await ctx.graphs.countImporters(graph.id!);

  if (importers > 0 && !opts.force) {
    throw new Error(
      `${graph.uid} is imported by ${importers} graph(s); those imports will stop resolving. Re-run with --force.`
    );
  }

  // Confirm only where a human can answer. Under --json, or with no TTY,
  // the guards above are the only ones — asking would hang.
  if (!opts.force && !opts.yes && canPrompt(ctx)) {
    const confirmed = await ask.confirm({
      message: `Delete ${graph.uid}?`,
      default: false,
    });
    if (!confirmed) {
      ctx.printer.note('Cancelled.');
      return 1;
    }
  }

  await ctx.graphs.delete(graph.id!);
  ctx.printer.note(`Deleted ${graph.uid}`);
  if (ctx.printer.json) ctx.printer.data({ id: graph.id, uid: graph.uid });
}

export interface GraphForkOpts {
  into?: string;
  deep?: boolean;
  uid?: string;
  label?: string;
  visibility?: string;
}

export async function fork(ctx: Ctx, opts: GraphForkOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);

  const workspace = opts.into
    ? await ctx.lookupWorkspace(opts.into)
    : await ctx.workspaceId();
  if (!workspace) {
    throw new Error(`No workspace "${opts.into}" that you can see.`);
  }

  const result = await cloneGraph(ctx.pb, graph.id!, {
    workspace,
    deep: opts.deep,
    uid: opts.uid,
    label: opts.label,
    visibility: opts.visibility as Graph['visibility'] | undefined,
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
}

export async function forks(ctx: Ctx, opts: ListOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const result = await fetchList(
    ctx.graphs,
    `forkedFrom = "${graph.id}"`,
    opts
  );
  ctx.printer.list(result, listColumns, 'No forks.');
}

export async function importers(ctx: Ctx, opts: ListOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const result = await fetchList(
    ctx.imports,
    `child = "${graph.id}"`,
    opts,
    'parent'
  );
  ctx.printer.list(
    result,
    [
      { header: 'ALIAS', get: (i) => i.alias },
      {
        header: 'PARENT',
        get: (i) =>
          (i.expand as { parent?: Graph } | undefined)?.parent?.uid ?? i.parent,
      },
      { header: 'IMPORT ID', get: (i) => i.id ?? '' },
    ],
    'Nothing imports this graph.'
  );
}

export function registerGraph(program: Command, rt: Runtime): void {
  const graph = program
    .command('graph')
    .summary('graphs — create, inspect, publish, fork')
    .description(
      'Graphs — create, inspect, update, fork.\n\n' +
        'A graph is a set of nodes plus imports of other graphs. It lives in exactly\n' +
        'one workspace, which is what decides who can touch it. Reference a graph by\n' +
        'record id or by its uid everywhere.'
    );

  addListOptions(
    graph
      .command('ls')
      .summary('list graphs')
      .description(
        'List graphs. Defaults to the active workspace.\n\n' +
          '--search and --tag query the public library instead (the search only covers\n' +
          'graphs published for reuse). Tag matches are narrowed to exact client-side,\n' +
          'so a page can come back shorter than --per-page.'
      )
      .option('--mine', 'graphs you created, in any workspace')
      .addOption(new Option('--public', 'the public library').conflicts('mine'))
      .addOption(
        new Option(
          '--search <text>',
          'search the public library by label/name/uid/description'
        ).conflicts('mine')
      )
      .addOption(
        new Option('--tag <tag>', 'require a library tag (repeatable)')
          .conflicts('mine')
          .argParser<string[]>((value, previous) =>
            previous ? [...previous, value] : [value]
          )
      )
  )
    .addHelpText(
      'after',
      `
Examples:
  graphware graph ls
  graphware graph ls --filter 'visibility != "private"' --sort '-updated'
  graphware graph ls --search fuse --tag automotive
  graphware graph ls --all --json`
    )
    .action(rt.act(ls));

  graph
    .command('new')
    .summary('create a graph')
    .description(
      'Create a graph in the active workspace (or -w <workspace>).\n\n' +
        'On a TTY, missing fields are prompted for.'
    )
    .option('--uid <uid>', 'unique identifier, e.g. LightSwitch')
    .option('--name <machine_name>', 'machine name, e.g. light_switch')
    .option('--label <label>', 'display name')
    .option('--namespace <ns>', 'grouping namespace')
    .addOption(visibilityOption('who can see it (default: private)'))
    .option('--description <text>', 'what this graph is')
    .action(rt.act(create));

  graph
    .command('show')
    .summary('show a graph with its nodes, imports and latest version')
    .description(
      'Show a graph, with counts of its nodes and imports, how many graphs import\n' +
        'it, and its latest published version.'
    )
    .argument('<id|uid>', 'the graph to show')
    .action(rt.act(show));

  graph
    .command('set')
    .summary('update a graph')
    .description('Update graph fields. Only the flags you pass are changed.')
    .argument('<id|uid>', 'the graph to update')
    .option('--label <label>', 'display name')
    .option('--name <name>', 'machine name')
    .option('--namespace <ns>', 'grouping namespace')
    .addOption(visibilityOption('who can see it'))
    .option('--description <text>', 'what this graph is')
    .action(rt.act(set));

  graph
    .command('rm')
    .summary('delete a graph')
    .description(
      'Delete a graph.\n\n' +
        'Refuses without --force when other graphs import this one, since deleting\n' +
        'it breaks their resolution. On a TTY it asks first; --yes skips that.'
    )
    .argument('<id|uid>', 'the graph to delete')
    .option('--force', 'delete even while other graphs import this one')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(rt.act(rm));

  graph
    .command('fork')
    .summary('copy a graph into a workspace you can write')
    .description(
      'Copy a graph into a workspace you can write (default: the active one).\n\n' +
        'A deep fork copies the whole import subtree, copying a multiply-imported\n' +
        'child once. Imports that point outside the copied set are left pointing at\n' +
        'the originals and are reported.'
    )
    .argument('<id|uid>', 'the graph to fork')
    .option('--into <slug|id>', 'destination workspace')
    .option('--deep', 'also copy every imported graph')
    .option('--uid <uid>', 'uid for the copy (default: derived)')
    .option('--label <label>', 'label for the copy')
    .addOption(visibilityOption('visibility for the copy'))
    .action(rt.act(fork));

  addListOptions(
    graph
      .command('forks')
      .summary('list graphs forked from this one')
      .description('List graphs recorded as forked from this one.')
      .argument('<id|uid>', 'the origin graph')
  ).action(rt.act(forks));

  addListOptions(
    graph
      .command('importers')
      .summary('list graphs that import this one')
      .description(
        'List the graphs that import this one — the impact set of a change to it.'
      )
      .argument('<id|uid>', 'the imported graph')
  ).action(rt.act(importers));
}
