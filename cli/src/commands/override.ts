// Edge-override commands.
//
// Edges are derived, never stored. An override patches that derivation — `pin`
// adds an edge the matcher did not make, `suppress` removes one it did — which
// is why the endpoints are instance paths, not record ids.
import {
  GraphEdgeOverrideInputSchema,
  type GraphEdgeOverride,
} from '@project/shared';
import { str, type Command } from '../command.ts';
import { resolveGraph } from '../resolve-ref.ts';

const columns = [
  { header: 'MODE', get: (o: GraphEdgeOverride) => o.mode },
  {
    header: 'SOURCE',
    get: (o: GraphEdgeOverride) => `${o.sourcePath}:${o.sourcePort}`,
  },
  {
    header: 'TARGET',
    get: (o: GraphEdgeOverride) => `${o.targetPath}:${o.targetPort}`,
  },
  { header: 'REASON', get: (o: GraphEdgeOverride) => o.reason ?? '' },
  { header: 'ID', get: (o: GraphEdgeOverride) => o.id ?? '' },
];

export const ls: Command = {
  summary: 'List the edge overrides on a graph',
  usage: 'graphware override ls <graph>',
  details:
    'Overrides belong to the root graph only — they do not inherit into an\nimporting graph, because the instance paths would not mean the same thing.',
  positionals: [{ name: 'graph', required: true }],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const items = await ctx.overrides.listForGraph(graph.id!);
    ctx.printer.list(items, columns, 'No overrides.');
  },
};

export const add: Command = {
  summary: 'Pin or suppress a derived edge',
  usage:
    'graphware override add <graph> --mode pin|suppress --source-path <path> --source-port <port> --target-path <path> --target-port <port> [--reason <text>]',
  details:
    'A path is the instance id from `graphware resolve` — the chain of import\naliases plus the node name. Use "" for a node on the root graph.',
  positionals: [{ name: 'graph', required: true }],
  options: {
    mode: { type: 'string' },
    'source-path': { type: 'string' },
    'source-port': { type: 'string' },
    'target-path': { type: 'string' },
    'target-port': { type: 'string' },
    reason: { type: 'string' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);

    // Validate with the same schema the create path uses, so a bad mode or a
    // missing endpoint is a readable local error rather than a server 400.
    const input = GraphEdgeOverrideInputSchema.parse({
      graph: graph.id!,
      mode: str(args, 'mode'),
      sourcePath: str(args, 'source-path'),
      sourcePort: str(args, 'source-port'),
      targetPath: str(args, 'target-path'),
      targetPort: str(args, 'target-port'),
      reason: str(args, 'reason'),
    });

    const override = await ctx.overrides.create(input);
    ctx.printer.note(
      `${override.mode}: ${override.sourcePath}:${override.sourcePort} → ${override.targetPath}:${override.targetPort}`
    );
    if (ctx.printer.json) ctx.printer.data(override);
  },
};

export const rm: Command = {
  summary: 'Delete an edge override',
  usage: 'graphware override rm <overrideId>',
  positionals: [{ name: 'overrideId', required: true }],
  options: {},
  async run(ctx, args) {
    const id = args.positionals[0];
    await ctx.overrides.delete(id);
    ctx.printer.note(`Deleted override ${id}`);
    if (ctx.printer.json) ctx.printer.data({ id });
  },
};
