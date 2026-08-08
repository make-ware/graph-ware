// Turning what a human or agent typed into a record id.
//
// Every reference the CLI takes is "id or the friendly name" — a graph by id or
// uid, a version by id or version number. Doing this in one place is what keeps
// `graphware node ls LightSwitch` from being a special case someone forgot.
import type { Graph, GraphVersion } from '@project/shared';
import type { Ctx } from './context.ts';

/**
 * A graph by record id or by `uid`.
 *
 * One filtered read that matches either, rather than a `getById` and a
 * fallback: a speculative read-by-id of something that is actually a uid is a
 * 404, and the mutators log every 404 with a stack trace even when the caller
 * asked to tolerate it. On a CLI that noise lands on stderr next to the result.
 */
export async function resolveGraph(ctx: Ctx, ref: string): Promise<Graph> {
  const quoted = escape(ref);
  const graph = await ctx.graphs.getFirstByFilter(
    `id = "${quoted}" || uid = "${quoted}"`
  );
  if (graph) return graph;

  throw new Error(
    `No graph "${ref}" that you can read. Try \`graphware graph ls\`.`
  );
}

/**
 * A version by record id or by bare version number (`3`, or `v3`).
 *
 * The number form is what a human reads off `version ls`, and it is only
 * meaningful relative to a graph — which is why this takes one.
 */
export async function resolveVersion(
  ctx: Ctx,
  graphId: string,
  ref: string
): Promise<GraphVersion> {
  const graph = escape(graphId);
  const numeric = ref.replace(/^v/i, '');

  const filter = /^\d+$/.test(numeric)
    ? `graph = "${graph}" && version = ${Number(numeric)}`
    : `graph = "${graph}" && id = "${escape(ref)}"`;

  const version = await ctx.versions.getFirstByFilter(filter);
  if (version) return version;

  throw new Error(`That graph has no version "${ref}".`);
}

/**
 * A value that is either inline JSON or `@path` pointing at a file.
 *
 * The `@file` form exists because ports and attribute maps get long, and
 * shell-quoting a multi-line JSON array is where an agent's invocation breaks.
 */
export async function readJsonArg(value: string): Promise<unknown> {
  let text = value;
  if (value.startsWith('@')) {
    const { readFile } = await import('node:fs/promises');
    text = await readFile(value.slice(1), 'utf8');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse JSON: ${detail}`);
  }
}

/**
 * Escape a value for a PocketBase filter string literal.
 *
 * The mutators build filters by interpolation, so a uid containing a quote
 * would otherwise produce a malformed filter — a 400 that reads like a server
 * bug rather than bad input.
 */
export function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
