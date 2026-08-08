// resolve and lint — the two read commands that run the engine.
//
// This is where the CLI earns its keep for an agent: `resolve` answers "what
// does this graph actually become", including edges nobody stored, and `lint`
// turns the same run into a pass/fail with an exit code.
import { Option, type Command } from 'commander';
import { loadImportTree, assembleResolvedGraph } from '@project/shared/graph';
import { resolveGraphView } from '@project/shared/graph';
import type { Ctx } from '../context.ts';
import { positiveInt } from '../options.ts';
import { renderDiagnostics, renderEdges, renderTree } from '../render.ts';
import { resolveGraph } from '../resolve-ref.ts';
import type { Runtime } from '../runtime.ts';

export interface ResolveOpts {
  format: string;
  depth?: number;
  maxNodes?: number;
  structure?: boolean;
}

export async function resolve(ctx: Ctx, opts: ResolveOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const engineOpts = { maxDepth: opts.depth, maxNodes: opts.maxNodes };

  if (opts.structure) {
    const data = await loadImportTree(ctx.pb, graph.id!, engineOpts);
    const { graph: resolved, diagnostics } = assembleResolvedGraph(
      graph.id!,
      data,
      engineOpts
    );
    ctx.printer.data({ graph: resolved, diagnostics });
    return;
  }

  const view = await resolveGraphView(ctx.pb, graph.id!, engineOpts);

  if (ctx.printer.json) {
    ctx.printer.data(view);
    return;
  }

  const { format } = opts;
  if (format === 'nodes' || format === 'tree' || format === 'all') {
    renderTree(ctx.printer, view);
  }
  if (format === 'edges' || format === 'all') {
    renderEdges(ctx.printer, view);
  }
  if (format === 'diagnostics' || format === 'all') {
    renderDiagnostics(ctx.printer, view);
    if (format === 'diagnostics' && !view.diagnostics.length) {
      ctx.printer.note('No diagnostics.');
    }
  }
}

export interface LintOpts {
  strict?: boolean;
  depth?: number;
  maxNodes?: number;
}

export async function lint(ctx: Ctx, opts: LintOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const view = await resolveGraphView(ctx.pb, graph.id!, {
    maxDepth: opts.depth,
    maxNodes: opts.maxNodes,
  });

  const errors = view.diagnostics.filter((d) => d.level === 'error');
  const failed = opts.strict ? view.diagnostics.length > 0 : errors.length > 0;

  if (ctx.printer.json) {
    ctx.printer.data({
      graph: graph.id,
      uid: graph.uid,
      diagnostics: view.diagnostics,
      errorCount: errors.length,
      warningCount: view.diagnostics.length - errors.length,
      ok: !failed,
    });
    return failed ? 1 : 0;
  }

  if (!view.diagnostics.length) {
    ctx.printer.note(
      `${graph.uid}: clean — ${view.nodes.length} node(s), ${view.edges.length} edge(s).`
    );
    return 0;
  }

  renderDiagnostics(ctx.printer, view);
  return failed ? 1 : 0;
}

/** Shared by `resolve` and `lint`: the engine's own guard rails. */
function addEngineOptions(command: Command): Command {
  return command
    .option(
      '--depth <n>',
      'stop resolving imports below this depth',
      positiveInt
    )
    .option(
      '--max-nodes <n>',
      'stop flattening after this many nodes',
      positiveInt
    );
}

export function registerResolve(program: Command, rt: Runtime): void {
  addEngineOptions(
    program
      .command('resolve')
      .summary('resolve a graph: flat nodes, derived edges, diagnostics')
      .description(
        'Resolve a graph to flat nodes, derived edges and diagnostics.\n\n' +
          'Edges are computed from port compatibility at read time; nothing about\n' +
          'them is stored. Nodes are addressed by instance path — the chain of\n' +
          'import aliases — so a child imported twice shows up as two distinct\n' +
          'instances. Those paths are what `override add` endpoints take.\n\n' +
          '--structure skips the engine and shows only the import tree.'
      )
      .argument('<graph>', 'the graph (id or uid)')
      .addOption(
        new Option('--format <what>', 'which sections to print (human mode)')
          .choices(['tree', 'nodes', 'edges', 'diagnostics', 'all'])
          .default('all')
      )
      .option('--structure', 'show the import tree only, without the engine')
  )
    .addHelpText(
      'after',
      `
Examples:
  graphware resolve LightSwitch
  graphware resolve PowerSystem --format edges
  graphware resolve PowerSystem --json | jq '.diagnostics'`
    )
    .action(rt.act(resolve));

  addEngineOptions(
    program
      .command('lint')
      .summary('resolve a graph and report its diagnostics')
      .description(
        'Resolve a graph and report its diagnostics.\n\n' +
          'Exits 1 when any diagnostic is an error — an unconnected required\n' +
          'input, an unknown port kind. --strict makes warnings fail too, which is\n' +
          'the mode worth putting in CI.'
      )
      .argument('<graph>', 'the graph (id or uid)')
      .option('--strict', 'fail on warnings as well as errors')
  ).action(rt.act(lint));
}
