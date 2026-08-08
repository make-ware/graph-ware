// Node commands.
//
// Attributes and ports are validated JSON on the record, not separate rows, so
// the CLI takes them as JSON and runs them through the same zod schemas the
// editor forms use — a bad port shape fails here with a field path rather than
// as a 400 from the server.
import type { Command } from 'commander';
import {
  AttributeListSchema,
  NodePositionSchema,
  PortListSchema,
  type GraphNode,
} from '@project/shared';
import type { Ctx } from '../context.ts';
import { addListOptions, fetchList, type ListOpts } from '../listing.ts';
import { ask, canPrompt } from '../prompt.ts';
import { addCheckOption, checkGraph, withDiagnostics } from '../render.ts';
import { readJsonArg, resolveGraph } from '../resolve-ref.ts';
import type { Runtime } from '../runtime.ts';

const columns = [
  { header: 'NAME', get: (n: GraphNode) => n.name },
  { header: 'LABEL', get: (n: GraphNode) => n.label },
  {
    header: 'PORTS',
    get: (n: GraphNode) =>
      (n.ports ?? [])
        .map((p) => `${p.name}:${p.direction === 'output' ? 'out' : 'in'}`)
        .join(' '),
  },
  {
    header: 'ATTRS',
    get: (n: GraphNode) => String((n.attributes ?? []).length),
    align: 'right' as const,
  },
  { header: 'ID', get: (n: GraphNode) => n.id ?? '' },
];

/** `x,y` — the shorthand a human types; also accepts `{"x":1,"y":2}`. */
function parsePosition(raw: string) {
  const pair = raw.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
  const value = pair
    ? { x: Number(pair[1]), y: Number(pair[2]) }
    : JSON.parse(raw);
  return NodePositionSchema.parse(value);
}

export async function ls(ctx: Ctx, opts: ListOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const result = await fetchList(ctx.nodes, `graph = "${graph.id}"`, opts);
  ctx.printer.list(result, columns, 'No nodes.');
}

export async function show(ctx: Ctx, _opts: unknown, id: string) {
  const node = await ctx.nodes.getById(id);
  if (!node) throw new Error(`No node "${id}".`);
  // Ports and attributes are structured; a table would flatten away exactly
  // the part a caller asked `show` for.
  ctx.printer.data(node);
}

export interface NodeAddOpts {
  name?: string;
  label?: string;
  attributes?: string;
  ports?: string;
  position?: string;
  check?: boolean;
}

export async function add(ctx: Ctx, opts: NodeAddOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);

  let { name, label } = opts;
  if ((!name || !label) && canPrompt(ctx)) {
    label = label ?? (await ask.input({ message: 'Label (display name):' }));
    name =
      name ??
      (await ask.input({
        message: 'Machine name:',
        default: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      }));
  }
  if (!name || !label) throw new Error('--name and --label are required');

  const node = await ctx.nodes.create({
    graph: graph.id!,
    name,
    label,
    attributes: opts.attributes
      ? AttributeListSchema.parse(await readJsonArg(opts.attributes))
      : undefined,
    ports: opts.ports
      ? PortListSchema.parse(await readJsonArg(opts.ports))
      : undefined,
    position: opts.position ? parsePosition(opts.position) : undefined,
  });

  ctx.printer.note(`Added ${node.name} (${node.id}) to ${graph.uid}`);
  const diagnostics = opts.check ? await checkGraph(ctx, graph.id!) : undefined;
  if (ctx.printer.json) ctx.printer.data(withDiagnostics(node, diagnostics));
}

export interface NodeSetOpts {
  name?: string;
  label?: string;
  attributes?: string;
  ports?: string;
  position?: string;
  clearPosition?: boolean;
  check?: boolean;
}

export async function set(ctx: Ctx, opts: NodeSetOpts, id: string) {
  const existing = await ctx.nodes.getById(id);
  if (!existing) throw new Error(`No node "${id}".`);

  const patch: Partial<GraphNode> = {};
  if (opts.name !== undefined) patch.name = opts.name;
  if (opts.label !== undefined) patch.label = opts.label;

  if (opts.attributes !== undefined) {
    patch.attributes = AttributeListSchema.parse(
      await readJsonArg(opts.attributes)
    );
  }

  if (opts.ports !== undefined) {
    patch.ports = PortListSchema.parse(await readJsonArg(opts.ports));
  }

  if (opts.clearPosition) {
    // Explicitly null, not undefined: an undefined key is dropped from the
    // request body and the stored position would survive untouched.
    patch.position = null as unknown as GraphNode['position'];
  } else if (opts.position !== undefined) {
    patch.position = parsePosition(opts.position);
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to change. Pass at least one field flag.');
  }

  const node = await ctx.nodes.update(id, patch);
  ctx.printer.note(`Updated ${node.name}`);
  const diagnostics = opts.check
    ? await checkGraph(ctx, existing.graph)
    : undefined;
  if (ctx.printer.json) ctx.printer.data(withDiagnostics(node, diagnostics));
}

export interface NodeRmOpts {
  yes?: boolean;
  check?: boolean;
}

export async function rm(ctx: Ctx, opts: NodeRmOpts, id: string) {
  const existing = await ctx.nodes.getById(id);
  if (!existing) throw new Error(`No node "${id}".`);

  if (!opts.yes && canPrompt(ctx)) {
    const confirmed = await ask.confirm({
      message: `Delete node ${existing.name}?`,
      default: false,
    });
    if (!confirmed) {
      ctx.printer.note('Cancelled.');
      return 1;
    }
  }

  await ctx.nodes.delete(id);
  ctx.printer.note(`Deleted node ${existing.name} (${id})`);
  const diagnostics = opts.check
    ? await checkGraph(ctx, existing.graph)
    : undefined;
  if (ctx.printer.json) ctx.printer.data(withDiagnostics({ id }, diagnostics));
}

const PORTS_EXAMPLE = `
The JSON shapes (also accepted as @file.json):
  --ports      '[{"name":"out","direction":"output","kind":"power","relationship":"many"}]'
  --attributes '[{"name":"voltage","value":12}]'
  --position   '120,80'

Example — add a fuse and see what it connects to:
  graphware node add PowerSystem --name fuse --label Fuse \\
    --ports '[{"name":"in","direction":"input","kind":"power","relationship":"one"},
              {"name":"out","direction":"output","kind":"power","relationship":"many"}]' \\
    --check`;

export function registerNode(program: Command, rt: Runtime): void {
  const node = program
    .command('node')
    .summary('nodes within a graph')
    .description(
      'Nodes within a graph.\n\n' +
        'A node carries typed ports and attributes as validated JSON. Edges are\n' +
        'never written: they are derived from port kind compatibility when the graph\n' +
        'is resolved — so after changing ports or attributes, `--check` (or\n' +
        '`graphware resolve`) is how you see what the change actually connected.'
    );

  addListOptions(
    node
      .command('ls')
      .summary('list the nodes of a graph')
      .description('List the nodes of a graph.')
      .argument('<graph>', 'the graph (id or uid)')
  ).action(rt.act(ls));

  node
    .command('show')
    .summary('show one node with its full ports and attributes')
    .description(
      'Show one node whole — ports, attributes and position — as JSON.'
    )
    .argument('<nodeId>', 'the node record id (see `node ls`)')
    .action(rt.act(show));

  addCheckOption(
    node
      .command('add')
      .summary('add a node to a graph')
      .description(
        'Add a node to a graph. On a TTY, a missing name or label is prompted for.'
      )
      .argument('<graph>', 'the graph (id or uid)')
      .option('--name <machine_name>', 'machine name, unique within the graph')
      .option('--label <label>', 'display name')
      .option('--attributes <json|@file>', 'attribute list as JSON')
      .option('--ports <json|@file>', 'port list as JSON')
      .option('--position <x,y>', 'manual canvas position')
  )
    .addHelpText('after', PORTS_EXAMPLE)
    .action(rt.act(add));

  addCheckOption(
    node
      .command('set')
      .summary('update a node')
      .description(
        'Update node fields. Only the flags you pass are changed; --attributes and\n' +
          '--ports replace the whole list.\n\n' +
          '--clear-position drops the manual layout override so the node goes back\n' +
          'to being placed by dagre.'
      )
      .argument('<nodeId>', 'the node record id')
      .option('--name <name>', 'machine name')
      .option('--label <label>', 'display name')
      .option('--attributes <json|@file>', 'replacement attribute list')
      .option('--ports <json|@file>', 'replacement port list')
      .option('--position <x,y>', 'manual canvas position')
      .option('--clear-position', 'drop the manual position')
  )
    .addHelpText('after', PORTS_EXAMPLE)
    .action(rt.act(set));

  addCheckOption(
    node
      .command('rm')
      .summary('delete a node')
      .description(
        'Delete a node. On a TTY it asks first; --yes skips that. Derived edges\n' +
          'involving the node simply stop being derived.'
      )
      .argument('<nodeId>', 'the node record id')
      .option('-y, --yes', 'skip the confirmation prompt')
  ).action(rt.act(rm));
}
