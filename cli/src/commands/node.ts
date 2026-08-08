// Node commands.
//
// Attributes and ports are validated JSON on the record, not separate rows, so
// the CLI takes them as JSON and runs them through the same zod schemas the
// editor forms use — a bad port shape fails here with a field path rather than
// as a 400 from the server.
import {
  AttributeListSchema,
  NodePositionSchema,
  PortListSchema,
  type GraphNode,
} from '@project/shared';
import { bool, str, type Command } from '../command.ts';
import { readJsonArg, resolveGraph } from '../resolve-ref.ts';

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

export const ls: Command = {
  summary: 'List the nodes of a graph',
  usage: 'graphware node ls <graph>',
  positionals: [{ name: 'graph', required: true }],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const result = await ctx.nodes.listForGraph(graph.id!);
    ctx.printer.list(result.items, columns, 'No nodes.');
  },
};

export const show: Command = {
  summary: 'Show one node with its full ports and attributes',
  usage: 'graphware node show <nodeId>',
  positionals: [{ name: 'nodeId', required: true }],
  options: {},
  async run(ctx, args) {
    const node = await ctx.nodes.getById(args.positionals[0]);
    if (!node) throw new Error(`No node "${args.positionals[0]}".`);
    // Ports and attributes are structured; a table would flatten away exactly
    // the part a caller asked `show` for.
    ctx.printer.data(node);
  },
};

export const add: Command = {
  summary: 'Add a node to a graph',
  usage:
    'graphware node add <graph> --name <machine_name> --label <label> [--attributes <json|@file>] [--ports <json|@file>] [--position x,y]',
  positionals: [{ name: 'graph', required: true }],
  options: {
    name: { type: 'string' },
    label: { type: 'string' },
    attributes: { type: 'string' },
    ports: { type: 'string' },
    position: { type: 'string' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const name = str(args, 'name');
    const label = str(args, 'label');
    if (!name || !label) throw new Error('--name and --label are required');

    const attributesRaw = str(args, 'attributes');
    const portsRaw = str(args, 'ports');
    const positionRaw = str(args, 'position');

    const node = await ctx.nodes.create({
      graph: graph.id!,
      name,
      label,
      attributes: attributesRaw
        ? AttributeListSchema.parse(await readJsonArg(attributesRaw))
        : undefined,
      ports: portsRaw
        ? PortListSchema.parse(await readJsonArg(portsRaw))
        : undefined,
      position: positionRaw ? parsePosition(positionRaw) : undefined,
    });

    ctx.printer.note(`Added ${node.name} (${node.id}) to ${graph.uid}`);
    if (ctx.printer.json) ctx.printer.data(node);
  },
};

export const set: Command = {
  summary: 'Update a node',
  usage:
    'graphware node set <nodeId> [--name <name>] [--label <label>] [--attributes <json|@file>] [--ports <json|@file>] [--position x,y | --clear-position]',
  details:
    '--clear-position drops the manual layout override so the node goes back to\nbeing placed by dagre.',
  positionals: [{ name: 'nodeId', required: true }],
  options: {
    name: { type: 'string' },
    label: { type: 'string' },
    attributes: { type: 'string' },
    ports: { type: 'string' },
    position: { type: 'string' },
    'clear-position': { type: 'boolean' },
  },
  async run(ctx, args) {
    const id = args.positionals[0];
    const existing = await ctx.nodes.getById(id);
    if (!existing) throw new Error(`No node "${id}".`);

    const patch: Partial<GraphNode> = {};
    if (str(args, 'name') !== undefined) patch.name = str(args, 'name');
    if (str(args, 'label') !== undefined) patch.label = str(args, 'label');

    const attributesRaw = str(args, 'attributes');
    if (attributesRaw !== undefined) {
      patch.attributes = AttributeListSchema.parse(
        await readJsonArg(attributesRaw)
      );
    }

    const portsRaw = str(args, 'ports');
    if (portsRaw !== undefined) {
      patch.ports = PortListSchema.parse(await readJsonArg(portsRaw));
    }

    const positionRaw = str(args, 'position');
    if (bool(args, 'clear-position')) {
      // Explicitly null, not undefined: an undefined key is dropped from the
      // request body and the stored position would survive untouched.
      patch.position = null as unknown as GraphNode['position'];
    } else if (positionRaw !== undefined) {
      patch.position = parsePosition(positionRaw);
    }

    if (Object.keys(patch).length === 0) {
      throw new Error('Nothing to change. Pass at least one field flag.');
    }

    const node = await ctx.nodes.update(id, patch);
    ctx.printer.note(`Updated ${node.name}`);
    if (ctx.printer.json) ctx.printer.data(node);
  },
};

export const rm: Command = {
  summary: 'Delete a node',
  usage: 'graphware node rm <nodeId>',
  positionals: [{ name: 'nodeId', required: true }],
  options: {},
  async run(ctx, args) {
    const id = args.positionals[0];
    await ctx.nodes.delete(id);
    ctx.printer.note(`Deleted node ${id}`);
    if (ctx.printer.json) ctx.printer.data({ id });
  },
};
