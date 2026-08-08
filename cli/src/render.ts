// Human renderings of a resolved graph view, shared by `resolve`, `lint` and
// the `--check` flag on mutating commands.
import { Command } from 'commander';
import { resolveGraphView } from '@project/shared/graph';
import {
  formatInstancePath,
  type FlatNode,
  type GraphView,
} from '@project/shared';
import type { Ctx } from './context.ts';
import type { Printer } from './output.ts';

export type Diagnostics = GraphView['diagnostics'];

/** Instance id → the node, for edge rendering. */
function index(nodes: readonly FlatNode[]) {
  return new Map(nodes.map((node) => [node.instanceId, node]));
}

export function renderTree(printer: Printer, view: GraphView) {
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

export function renderEdges(printer: Printer, view: GraphView) {
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

export function renderDiagnostics(printer: Printer, view: GraphView) {
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

/** Attach `--check` to a mutating command. */
export function addCheckOption(command: Command): Command {
  return command.option(
    '--check',
    'after the write, resolve the graph and report its diagnostics'
  );
}

/**
 * The `--check` follow-up: resolve the touched graph and report what the
 * change did to it. This is the write-half of the agent loop — append data,
 * read the diagnostics, keep building — without a second invocation.
 *
 * Returns the diagnostics for the JSON payload; in human mode it prints them
 * (or an explicit all-clear, so silence never has to be interpreted).
 */
export async function checkGraph(
  ctx: Ctx,
  graphId: string
): Promise<Diagnostics> {
  const view = await resolveGraphView(ctx.pb, graphId);
  if (view.diagnostics.length) {
    renderDiagnostics(ctx.printer, view);
  } else {
    ctx.printer.note(
      `check: clean — ${view.nodes.length} node(s), ${view.edges.length} edge(s), no diagnostics.`
    );
  }
  return view.diagnostics;
}

/**
 * Fold `--check` diagnostics into a JSON payload. Records never carry a
 * `diagnostics` field of their own, so the merge is collision-free.
 */
export function withDiagnostics<T extends object>(
  payload: T,
  diagnostics: Diagnostics | undefined
): T | (T & { diagnostics: Diagnostics }) {
  return diagnostics ? { ...payload, diagnostics } : payload;
}
