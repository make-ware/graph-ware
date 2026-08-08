// resolve and lint — the two read commands that run the engine.
//
// This is where the CLI earns its keep for an agent: `resolve` answers "what
// does this graph actually become", including edges nobody stored, and `lint`
// turns the same run into a pass/fail with an exit code.
import { loadImportTree, assembleResolvedGraph } from '@project/shared/graph';
import { resolveGraphView } from '@project/shared/graph';
import {
  formatInstancePath,
  type FlatNode,
  type GraphView,
} from '@project/shared';
import { bool, int, str, type Command } from '../command.ts';
import type { Printer } from '../output.ts';
import { resolveGraph } from '../resolve-ref.ts';

/** Instance id → the node, for edge rendering. */
function index(nodes: readonly FlatNode[]) {
  return new Map(nodes.map((node) => [node.instanceId, node]));
}

function renderTree(printer: Printer, view: GraphView) {
  const byPath = new Map<string, FlatNode[]>();
  for (const node of view.nodes) {
    const key = node.instancePath.join('/');
    const bucket = byPath.get(key);
    if (bucket) bucket.push(node);
    else byPath.set(key, [node]);
  }

  for (const [key, nodes] of byPath) {
    printer.line(key === '' ? 'root' : formatInstancePath(key.split('/')));
    for (const node of nodes) {
      const ports = node.ports
        .map(
          (port) =>
            `${port.name}(${port.direction === 'output' ? '→' : '←'}${port.kind})`
        )
        .join(' ');
      printer.line(`  ${node.name}  ${node.label}${ports ? '  ' + ports : ''}`);
    }
  }
}

function renderEdges(printer: Printer, view: GraphView) {
  const nodes = index(view.nodes);

  // Qualified by instance path, not bare node name. A child imported twice
  // produces two nodes with the same name, and printing just the name turns
  // "port_bank's fuse feeds the controller" into what looks like a self-loop.
  const label = (instanceId: string) => {
    const node = nodes.get(instanceId);
    if (!node) return instanceId;
    const prefix = node.instancePath.length
      ? node.instancePath.join('/') + '/'
      : '';
    return prefix + node.name;
  };

  printer.line();
  printer.line(`${view.edges.length} edge(s):`);
  for (const edge of view.edges) {
    const marker = edge.origin === 'pinned' ? ' [pinned]' : '';
    printer.line(
      `  ${label(edge.sourceInstanceId)}.${edge.sourcePortName} → ` +
        `${label(edge.targetInstanceId)}.${edge.targetPortName}  [${edge.kind}]${marker}`
    );
  }
}

function renderDiagnostics(printer: Printer, view: GraphView) {
  if (!view.diagnostics.length) return;
  printer.line();
  printer.line(`${view.diagnostics.length} diagnostic(s):`);
  for (const diagnostic of view.diagnostics) {
    const where = diagnostic.path?.length
      ? ` (${diagnostic.path.join(' › ')})`
      : '';
    printer.line(
      `  ${diagnostic.level.padEnd(7)} ${diagnostic.code}  ${diagnostic.message}${where}`
    );
  }
}

export const resolve: Command = {
  summary: 'Resolve a graph to flat nodes, derived edges and diagnostics',
  usage:
    'graphware resolve <graph> [--format tree|nodes|edges|all] [--depth <n>] [--max-nodes <n>] [--structure]',
  details:
    'Edges are computed from port compatibility at read time; nothing about them\nis stored. --structure skips the engine and shows only the import tree.',
  positionals: [{ name: 'graph', required: true }],
  options: {
    format: { type: 'string' },
    depth: { type: 'string' },
    'max-nodes': { type: 'string' },
    structure: { type: 'boolean' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const maxDepth = int(args, 'depth');
    const maxNodes = int(args, 'max-nodes');

    if (bool(args, 'structure')) {
      const data = await loadImportTree(ctx.pb, graph.id!, {
        maxDepth,
        maxNodes,
      });
      const { graph: resolved, diagnostics } = assembleResolvedGraph(
        graph.id!,
        data,
        { maxDepth, maxNodes }
      );
      ctx.printer.data({ graph: resolved, diagnostics });
      return;
    }

    const view = await resolveGraphView(ctx.pb, graph.id!, {
      maxDepth,
      maxNodes,
    });

    if (ctx.printer.json) {
      ctx.printer.data(view);
      return;
    }

    const format = str(args, 'format') ?? 'all';
    if (format === 'nodes' || format === 'tree' || format === 'all') {
      renderTree(ctx.printer, view);
    }
    if (format === 'edges' || format === 'all') {
      renderEdges(ctx.printer, view);
    }
    if (format === 'all') {
      renderDiagnostics(ctx.printer, view);
    }
  },
};

export const lint: Command = {
  summary: 'Resolve a graph and report its diagnostics',
  usage: 'graphware lint <graph> [--strict] [--depth <n>] [--max-nodes <n>]',
  details:
    'Exits 1 when any diagnostic is an error — an unconnected required input, an\nunknown port kind. --strict makes warnings fail too, which is the mode worth\nputting in CI.',
  positionals: [{ name: 'graph', required: true }],
  options: {
    strict: { type: 'boolean' },
    depth: { type: 'string' },
    'max-nodes': { type: 'string' },
  },
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const view = await resolveGraphView(ctx.pb, graph.id!, {
      maxDepth: int(args, 'depth'),
      maxNodes: int(args, 'max-nodes'),
    });

    const errors = view.diagnostics.filter((d) => d.level === 'error');
    const strict = bool(args, 'strict');
    const failed = strict ? view.diagnostics.length > 0 : errors.length > 0;

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
  },
};
