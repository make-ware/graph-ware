// Child-graph import helpers: instance addressing and the cycle/depth rules.
//
// The authoritative cycle and depth guard is the PocketBase hook in
// `pocketbase/pb_hooks/graph-imports.pb.js` — API rules cannot walk an ancestor
// chain, so the check has to run server-side. Everything here is the client-side
// mirror: it powers pre-flight validation in the editor (disable the "add
// import" button, explain *why*) and it is what the unit tests exercise. If you
// change a rule here, change the hook too.
//
// Reference: docs/IMPORTS.md

import {
  INSTANCE_PATH_SEPARATOR,
  IMPORT_ALIAS_PATTERN,
  MAX_IMPORT_DEPTH,
  type InstancePath,
} from './primitives';

/** A parent → child import edge, reduced to just the two graph ids. */
export interface ImportEdge {
  parent: string;
  child: string;
}

// ---------------------------------------------------------------------------
// Instance addressing
// ---------------------------------------------------------------------------

/**
 * The unique handle on a node within a resolved tree.
 *
 * A graph may be imported more than once (`port_bank` and `starboard_bank` both
 * pointing at `BatterySystem`), so the node's record id repeats. Prefixing it
 * with the chain of import aliases makes it unique again — and readable, which
 * matters because `GraphEdgeOverrides` stores these paths verbatim.
 *
 * ```
 * buildInstanceId([], 'abc')                       // "abc"
 * buildInstanceId(['port_bank'], 'abc')            // "port_bank/abc"
 * buildInstanceId(['port_bank', 'cells'], 'abc')   // "port_bank/cells/abc"
 * ```
 */
export function buildInstanceId(path: InstancePath, nodeId: string): string {
  if (!path.length) return nodeId;
  return [...path, nodeId].join(INSTANCE_PATH_SEPARATOR);
}

/** Split an instance id back into its alias chain and the trailing node id. */
export function parseInstanceId(instanceId: string): {
  path: InstancePath;
  nodeId: string;
} {
  const segments = instanceId.split(INSTANCE_PATH_SEPARATOR);
  const nodeId = segments.pop() ?? '';
  return { path: segments, nodeId };
}

/** Human-facing rendering of an alias chain, e.g. `port_bank › cells`. */
export function formatInstancePath(path: InstancePath): string {
  return path.length ? path.join(' › ') : 'root';
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

export function isValidAlias(alias: string): boolean {
  return IMPORT_ALIAS_PATTERN.test(alias);
}

/**
 * Pick an alias that is free within a parent, appending `_2`, `_3`, … as needed.
 * Importing the same child twice is a supported, expected action, so the editor
 * needs a sensible default rather than an error.
 */
export function nextAvailableAlias(
  base: string,
  taken: Iterable<string>
): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

/**
 * Does this instance id sit underneath `alias` at the top level?
 *
 * `"port_bank/abc"` is under `port_bank`; `"abc"` (a root-graph node) and
 * `"port_bank_2/abc"` are not. The separator check is what keeps the second
 * case out — a bare `startsWith` would match every alias sharing a prefix.
 */
export function isUnderAlias(instanceId: string, alias: string): boolean {
  return instanceId.startsWith(`${alias}${INSTANCE_PATH_SEPARATOR}`);
}

/**
 * Re-point an instance id from one top-level alias to another.
 *
 * Renaming an import alias invalidates every `GraphEdgeOverride` beneath it,
 * because the alias is stored verbatim inside `sourcePath` / `targetPath`.
 * The editor rewrites those paths in the same operation rather than leaving
 * them to decay into `stale-override` warnings — see docs/IMPORTS.md.
 *
 * Ids that are not under `from` are returned untouched, so this is safe to map
 * over every override on the graph.
 */
export function rewriteAliasPrefix(
  instanceId: string,
  from: string,
  to: string
): string {
  if (!isUnderAlias(instanceId, from)) return instanceId;
  return `${to}${instanceId.slice(from.length)}`;
}

// ---------------------------------------------------------------------------
// Graph traversal over import edges
// ---------------------------------------------------------------------------

function adjacency(
  edges: readonly ImportEdge[],
  direction: 'down' | 'up'
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const from = direction === 'down' ? edge.parent : edge.child;
    const to = direction === 'down' ? edge.child : edge.parent;
    const existing = map.get(from);
    if (existing) existing.push(to);
    else map.set(from, [to]);
  }
  return map;
}

/** Every graph reachable by following imports downward from `start`. */
export function collectDescendants(
  start: string,
  edges: readonly ImportEdge[]
): Set<string> {
  return reachable(start, adjacency(edges, 'down'));
}

/** Every graph that (transitively) imports `start`. */
export function collectAncestors(
  start: string,
  edges: readonly ImportEdge[]
): Set<string> {
  return reachable(start, adjacency(edges, 'up'));
}

function reachable(start: string, links: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...(links.get(start) ?? [])];

  while (queue.length) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(links.get(current) ?? []));
  }

  return seen;
}

/**
 * Longest chain of graphs strictly beyond `start`, following `links`.
 *
 * Counts graphs, not edges: a leaf returns 0, a graph with one child returns 1.
 * Tolerates a pre-existing cycle in the data (returns a finite number) so that
 * a depth check never hangs on a database that somehow slipped one through.
 */
function longestChain(
  start: string,
  links: Map<string, string[]>,
  onPath: Set<string> = new Set()
): number {
  if (onPath.has(start)) return 0;
  onPath.add(start);

  let longest = 0;
  for (const next of links.get(start) ?? []) {
    longest = Math.max(longest, 1 + longestChain(next, links, onPath));
  }

  onPath.delete(start);
  return longest;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export type ImportRejection =
  | { ok: true }
  | { ok: false; reason: 'self'; message: string }
  | { ok: false; reason: 'cycle'; message: string }
  | { ok: false; reason: 'depth'; message: string; depth: number };

/**
 * Would adding `parent` → `child` be legal, given the imports that already exist?
 *
 * Rejects three things:
 * - a graph importing itself;
 * - an import that closes a loop, i.e. `parent` is already reachable downward
 *   from `child`;
 * - an import that pushes the deepest chain through it past `MAX_IMPORT_DEPTH`.
 *
 * A diamond (two parents importing the same child) is *not* a cycle and is
 * explicitly allowed — that is the reuse this whole model exists for.
 */
export function checkImport(
  parent: string,
  child: string,
  edges: readonly ImportEdge[]
): ImportRejection {
  if (parent === child) {
    return {
      ok: false,
      reason: 'self',
      message: 'A graph cannot import itself.',
    };
  }

  if (collectDescendants(child, edges).has(parent)) {
    return {
      ok: false,
      reason: 'cycle',
      message:
        'That import would create a loop — the child graph already imports this graph, directly or through another graph.',
    };
  }

  const up = adjacency(edges, 'up');
  const down = adjacency(edges, 'down');
  // Graphs in the deepest chain running through the new edge: everything
  // stacked above the parent, the parent and child themselves, and everything
  // hanging below the child.
  const depth = longestChain(parent, up) + 2 + longestChain(child, down);

  if (depth > MAX_IMPORT_DEPTH) {
    return {
      ok: false,
      reason: 'depth',
      message: `That import would nest graphs ${depth} deep; the limit is ${MAX_IMPORT_DEPTH}.`,
      depth,
    };
  }

  return { ok: true };
}

/** Convenience predicate over {@link checkImport} for the cycle case alone. */
export function wouldCreateCycle(
  parent: string,
  child: string,
  edges: readonly ImportEdge[]
): boolean {
  const result = checkImport(parent, child, edges);
  return !result.ok && (result.reason === 'cycle' || result.reason === 'self');
}
