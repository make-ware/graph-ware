// Edge-override commands.
//
// Edges are derived, never stored. An override patches that derivation — `pin`
// adds an edge the matcher did not make, `suppress` removes one it did — which
// is why the endpoints are instance paths, not record ids.
import { Option, type Command } from 'commander';
import {
  GraphEdgeOverrideInputSchema,
  type GraphEdgeOverride,
} from '@project/shared';
import type { Ctx } from '../context.ts';
import { addListOptions, fetchList, type ListOpts } from '../listing.ts';
import { ask, canPrompt } from '../prompt.ts';
import { addCheckOption, checkGraph, withDiagnostics } from '../render.ts';
import { resolveGraph } from '../resolve-ref.ts';
import type { Runtime } from '../runtime.ts';

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

export async function ls(ctx: Ctx, opts: ListOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const result = await fetchList(ctx.overrides, `graph = "${graph.id}"`, opts);
  ctx.printer.list(result, columns, 'No overrides.');
}

export interface OverrideAddOpts {
  mode?: string;
  sourcePath?: string;
  sourcePort?: string;
  targetPath?: string;
  targetPort?: string;
  reason?: string;
  check?: boolean;
}

export async function add(ctx: Ctx, opts: OverrideAddOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);

  // Validate with the same schema the create path uses, so a bad mode or a
  // missing endpoint is a readable local error rather than a server 400.
  const input = GraphEdgeOverrideInputSchema.parse({
    graph: graph.id!,
    mode: opts.mode,
    sourcePath: opts.sourcePath,
    sourcePort: opts.sourcePort,
    targetPath: opts.targetPath,
    targetPort: opts.targetPort,
    reason: opts.reason,
  });

  const override = await ctx.overrides.create(input);
  ctx.printer.note(
    `${override.mode}: ${override.sourcePath}:${override.sourcePort} → ${override.targetPath}:${override.targetPort}`
  );
  const diagnostics = opts.check ? await checkGraph(ctx, graph.id!) : undefined;
  if (ctx.printer.json) {
    ctx.printer.data(withDiagnostics(override, diagnostics));
  }
}

export interface OverrideRmOpts {
  yes?: boolean;
  check?: boolean;
}

export async function rm(ctx: Ctx, opts: OverrideRmOpts, id: string) {
  const existing = await ctx.overrides.getById(id);
  if (!existing) throw new Error(`No override "${id}".`);

  if (!opts.yes && canPrompt(ctx)) {
    const confirmed = await ask.confirm({
      message: `Delete ${existing.mode} override ${existing.sourcePath}:${existing.sourcePort} → ${existing.targetPath}:${existing.targetPort}?`,
      default: false,
    });
    if (!confirmed) {
      ctx.printer.note('Cancelled.');
      return 1;
    }
  }

  await ctx.overrides.delete(id);
  ctx.printer.note(`Deleted override ${id}`);
  const diagnostics = opts.check
    ? await checkGraph(ctx, existing.graph)
    : undefined;
  if (ctx.printer.json) ctx.printer.data(withDiagnostics({ id }, diagnostics));
}

export function registerOverride(program: Command, rt: Runtime): void {
  const override = program
    .command('override')
    .summary('edge overrides — pinning and suppressing derived edges')
    .description(
      'Edge overrides — pinning and suppressing derived edges.\n\n' +
        'Overrides belong to the root graph only: they do not inherit into an\n' +
        'importing graph, because the instance paths would not mean the same thing\n' +
        'there.'
    );

  addListOptions(
    override
      .command('ls')
      .summary('list the edge overrides on a graph')
      .description('List the edge overrides on a graph.')
      .argument('<graph>', 'the graph (id or uid)')
  ).action(rt.act(ls));

  addCheckOption(
    override
      .command('add')
      .summary('pin or suppress a derived edge')
      .description(
        'Pin an edge the matcher did not derive, or suppress one it did.\n\n' +
          'A path is the instance path from `graphware resolve` — the chain of\n' +
          'import aliases, "" for a node on the root graph. The port is the port\n' +
          'name on that node.'
      )
      .argument('<graph>', 'the graph (id or uid)')
      .addOption(
        new Option('--mode <mode>', 'pin adds the edge, suppress removes it')
          .choices(['pin', 'suppress'])
          .makeOptionMandatory()
      )
      .requiredOption('--source-path <path>', 'source node instance path')
      .requiredOption('--source-port <port>', 'source port name')
      .requiredOption('--target-path <path>', 'target node instance path')
      .requiredOption('--target-port <port>', 'target port name')
      .option('--reason <text>', 'why, shown in listings and the editor')
  )
    .addHelpText(
      'after',
      `
Example — suppress a derived edge inside an imported child:
  graphware override add PowerSystem --mode suppress \\
    --source-path battery_bank --source-port out \\
    --target-path "" --target-port main_in \\
    --reason "fed by the backup rail instead" --check`
    )
    .action(rt.act(add));

  addCheckOption(
    override
      .command('rm')
      .summary('delete an edge override')
      .description(
        'Delete an edge override, letting the derived result stand again.'
      )
      .argument('<overrideId>', 'the override record id')
      .option('-y, --yes', 'skip the confirmation prompt')
  ).action(rt.act(rm));
}
