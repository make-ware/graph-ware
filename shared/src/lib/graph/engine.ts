// The graph engine: flatten → focus → connect → override → validate → layout.
//
// Pure with respect to the DOM and the network. It takes a `ResolvedGraph`
// (whatever produced it) and returns everything the canvas needs. That purity
// is the whole reason it can be tested exhaustively, so keep it: no `pb`, no
// `window`, no `Date.now()`.
//
// Determinism is a requirement here, not a nicety. Nodes are processed in name
// order, ports in declaration order, matching is greedy with no backtracking.
// Shuffling the input must produce byte-identical output.
//
// Reference: docs/GRAPH_ENGINE.md

import { portFiltersPass } from './filters';
import { buildInstanceId, formatInstancePath } from './imports';
import {
  DEFAULT_PORT_RELATIONSHIP,
  type Attribute,
  type AttributeOverrideMap,
  type Port,
} from './primitives';
import { layoutGraph } from './layout';
import type { GraphEdgeOverride } from '../../schema/graph-edge-override';
import type {
  EngineOptions,
  FlatEdge,
  FlatNode,
  GraphDiagnostic,
  GraphView,
  PortKindRegistry,
  ResolvedGraph,
} from './types';

/**
 * Locale-independent string ordering.
 *
 * `localeCompare` varies with the runtime's ICU data, and the ordering here
 * decides which edge wins a `one` contention — so it has to be the same
 * everywhere.
 */
function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * The XYFlow handle id for a port: `supply-out-0`, `supply-in-1`.
 *
 * `index` is the port's position in the node's full `ports` array. Port names
 * are unique per direction, not per node — `house_fuse` has `supply` in both —
 * so the direction segment is what keeps the two apart, and the index keeps
 * the id unique even if that ever stops holding.
 */
export function portHandleId(port: Port, index: number): string {
  const side = port.direction === 'output' ? 'out' : 'in';
  return `${port.name}-${side}-${index}`;
}

/**
 * The inverse of {@link portHandleId}: recover a port's index and direction.
 *
 * The editor needs this because the derived layer and the stored layer address
 * ports differently. `FlatEdge.sourcePortName` is a handle id, but
 * `GraphEdgeOverrides.sourcePort` is a **bare port name** — `applyOverrides`
 * resolves it with `findPort`. Building an override straight from a selected
 * edge without converting stores a row that silently matches nothing and
 * resurfaces as a `stale-override` warning.
 *
 * Only the trailing two segments are parsed. Port names have no character
 * restrictions and may contain `-`, so splitting the whole id apart would
 * mangle `dc-supply-out-0`; the name is recovered by indexing into the node's
 * `ports` array instead (see {@link portNameFromHandle}).
 */
export function parsePortHandle(
  handle: string
): { direction: Port['direction']; index: number } | null {
  const lastDash = handle.lastIndexOf('-');
  if (lastDash === -1) return null;

  const index = Number(handle.slice(lastDash + 1));
  if (!Number.isInteger(index) || index < 0) return null;

  const sideDash = handle.lastIndexOf('-', lastDash - 1);
  if (sideDash === -1) return null;

  const side = handle.slice(sideDash + 1, lastDash);
  if (side !== 'out' && side !== 'in') return null;

  return { direction: side === 'out' ? 'output' : 'input', index };
}

/**
 * The bare port name behind a handle id, for storing on a `GraphEdgeOverride`.
 *
 * Resolved by index rather than by string surgery, so a port named `dc-supply`
 * round-trips. Returns `null` when the handle does not address a port that
 * exists on the node in the direction its id claims — a node edited since the
 * edge was derived.
 */
export function portNameFromHandle(
  node: Pick<FlatNode, 'ports'>,
  handle: string
): string | null {
  const parsed = parsePortHandle(handle);
  if (!parsed) return null;

  const port = node.ports[parsed.index];
  if (!port || port.direction !== parsed.direction) return null;

  return port.name;
}

function budgetKey(instanceId: string, portIndex: number): string {
  return `${instanceId}#${portIndex}`;
}

// ---------------------------------------------------------------------------
// 1. Flatten
// ---------------------------------------------------------------------------

/**
 * One import's `attributeOverrides`, tracked while its subtree is walked.
 *
 * Keys are instance ids *relative to the import that declared them*, so the
 * same map keeps working however deeply that import is nested — see
 * `AttributeOverrideMapSchema` in `./primitives`.
 */
interface OverrideScope {
  /** The instance path of the import that declared this map. */
  base: string[];
  /** Its breadcrumb, for a diagnostic that can say where the map lives. */
  breadcrumb: string[];
  map: AttributeOverrideMap;
  /** Keys that addressed a node that exists. */
  matchedKeys: Set<string>;
  /** `key#attribute` pairs that addressed an attribute that exists. */
  matchedAttributes: Set<string>;
}

/**
 * Apply every active override scope to one node's attributes.
 *
 * **Innermost first, so the outermost import wins.** A parent overriding
 * `b/NODE:voltage` is speaking about this exact instance in the system it owns;
 * the child's own override of `NODE:voltage` is a default it set for every
 * context. When both name the same attribute the more contextual instruction
 * should be the one that lands.
 *
 * Returns the node's own array untouched when nothing matched, so an unimported
 * graph pays nothing for this.
 */
function applyAttributeOverrides(
  attributes: readonly Attribute[],
  instancePath: readonly string[],
  nodeId: string,
  scopes: readonly OverrideScope[]
): Attribute[] {
  let result: Attribute[] | null = null;

  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    const key = buildInstanceId(instancePath.slice(scope.base.length), nodeId);
    const patch = scope.map[key];
    if (!patch) continue;

    scope.matchedKeys.add(key);

    for (const [name, value] of Object.entries(patch)) {
      const current: Attribute[] = result ?? [...attributes];
      const at = current.findIndex((attribute) => attribute.name === name);
      // An override replaces a value; it never introduces an attribute. A new
      // one would need a `kind` the override has nowhere to put, and a typo
      // would quietly become data instead of a warning.
      if (at === -1) continue;

      scope.matchedAttributes.add(`${key}#${name}`);
      current[at] = { ...current[at], value };
      result = current;
    }
  }

  return result ?? [...attributes];
}

/** Diagnostics for override keys that addressed nothing in the resolved tree. */
function staleOverrideDiagnostics(
  scopes: readonly OverrideScope[]
): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];

  for (const scope of scopes) {
    const where = formatInstancePath(scope.base);

    for (const [key, patch] of Object.entries(scope.map)) {
      if (!scope.matchedKeys.has(key)) {
        diagnostics.push({
          level: 'warning',
          code: 'stale-attribute-override',
          message: `The attribute override on "${where}" names ${key}, which is not a node in that subtree.`,
          path: [...scope.breadcrumb],
        });
        continue;
      }

      for (const name of Object.keys(patch)) {
        if (scope.matchedAttributes.has(`${key}#${name}`)) continue;
        diagnostics.push({
          level: 'warning',
          code: 'stale-attribute-override',
          message: `The attribute override on "${where}" sets "${name}" on ${key}, which has no attribute by that name.`,
          path: [...scope.breadcrumb],
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Every node in the tree, with its provenance and its per-import overrides
 * already applied.
 *
 * Depth-first: a graph's own nodes (name-ordered) come before its children's.
 * `graphColorIndex` counts *instances*, not graphs, so `port_bank` and
 * `starboard_bank` are two visual groups even though they are one
 * `BatterySystem`.
 *
 * Overrides land **here**, at the front of the pipeline, and not as a later
 * patch on the finished view. Auto-connect evaluates input-port filters against
 * a source node's attributes, so an override applied any later would change a
 * displayed value without changing the wiring it implies — which is precisely
 * the case `starboard_bank` at 24 V exists to exercise.
 *
 * `diagnostics`, when supplied, collects `stale-attribute-override` warnings.
 * It is an out-parameter rather than a second return value because the return
 * type of this function is load-bearing at thirty-odd call sites and the
 * warnings are wanted at exactly one of them.
 */
export function flattenGraph(
  root: ResolvedGraph,
  diagnostics?: GraphDiagnostic[]
): FlatNode[] {
  const flat: FlatNode[] = [];
  const scopes: OverrideScope[] = [];
  let nextColorIndex = 0;

  const walk = (
    graph: ResolvedGraph,
    instancePath: string[],
    breadcrumb: string[],
    active: OverrideScope[]
  ): void => {
    const graphColorIndex = nextColorIndex++;

    const ordered = [...graph.nodes].sort(
      (left, right) =>
        compareStrings(left.name, right.name) ||
        compareStrings(left.id, right.id)
    );

    for (const node of ordered) {
      flat.push({
        instanceId: buildInstanceId(instancePath, node.id),
        instancePath: [...instancePath],
        nodeId: node.id,
        name: node.name,
        label: node.label,
        graphId: graph.id,
        graphUid: graph.uid,
        graphName: graph.name,
        graphLabel: graph.label,
        graphNamespace: graph.namespace,
        breadcrumb: [...breadcrumb],
        graphColorIndex,
        attributes: active.length
          ? applyAttributeOverrides(
              node.attributes ?? [],
              instancePath,
              node.id,
              active
            )
          : (node.attributes ?? []),
        ports: node.ports ?? [],
        // A manual position is stored on the *record*, so an imported node
        // carries the same one under every alias — honouring it below the root
        // would stack `port_bank` and `starboard_bank` exactly on top of each
        // other. Imported instances get laid out instead.
        position: instancePath.length ? undefined : node.position,
      });
    }

    for (const child of graph.children) {
      const childPath = [...instancePath, child.alias];
      const childBreadcrumb = [...breadcrumb, child.label || child.graph.label];

      let childScopes = active;
      if (child.attributeOverrides) {
        const scope: OverrideScope = {
          base: childPath,
          breadcrumb: childBreadcrumb,
          map: child.attributeOverrides,
          matchedKeys: new Set(),
          matchedAttributes: new Set(),
        };
        scopes.push(scope);
        childScopes = [...active, scope];
      }

      walk(child.graph, childPath, childBreadcrumb, childScopes);
    }
  };

  walk(root, [], [root.label], []);

  if (diagnostics) diagnostics.push(...staleOverrideDiagnostics(scopes));

  return flat;
}

// ---------------------------------------------------------------------------
// 2. Focus
// ---------------------------------------------------------------------------

/**
 * Keep only the nodes under one instance path — the viewer's "focus on this
 * subgraph" control.
 *
 * By instance path, not graph id: focusing `port_bank` must not also select
 * `starboard_bank`, which is the same graph under a different alias.
 */
export function focusNodes(
  nodes: readonly FlatNode[],
  focus: readonly string[]
): FlatNode[] {
  if (!focus.length) return [...nodes];

  return nodes.filter((node) =>
    focus.every((segment, index) => node.instancePath[index] === segment)
  );
}

// ---------------------------------------------------------------------------
// 3. Auto-connect
// ---------------------------------------------------------------------------

/**
 * Can an output of `outputKind` reach an input of `inputKind`?
 *
 * Same kind always connects. Beyond that, `compatibleWith` is **symmetric**:
 * either kind listing the other is enough. Without a registry the engine has
 * no compatibility table to consult, so only identical kinds match — a port
 * naming an unregistered kind still wires up to its own kind, because the
 * registry is a presentation aid, not a gate.
 */
function kindsCompatible(
  outputKind: string,
  inputKind: string,
  registry?: PortKindRegistry
): boolean {
  if (outputKind === inputKind) return true;
  if (!registry) return false;

  if (registry[outputKind]?.compatibleWith?.includes(inputKind)) return true;
  return registry[inputKind]?.compatibleWith?.includes(outputKind) ?? false;
}

/**
 * Derive every edge in the flattened graph.
 *
 * Greedy and single-pass: the first eligible match wins and nothing backtracks,
 * so `one` contention resolves in node-name order. A global optimizer would
 * produce a better picture and a different one each time the data moved; the
 * same input producing the same picture is worth more.
 */
export function connectNodes(
  nodes: readonly FlatNode[],
  registry?: PortKindRegistry
): FlatEdge[] {
  const ordered = [...nodes].sort(
    (left, right) =>
      compareStrings(left.name, right.name) ||
      compareStrings(left.instanceId, right.instanceId)
  );

  const edges: FlatEdge[] = [];
  const inputClaims = new Map<string, number>();

  for (const source of ordered) {
    for (
      let sourceIndex = 0;
      sourceIndex < source.ports.length;
      sourceIndex++
    ) {
      const sourcePort = source.ports[sourceIndex];
      if (sourcePort.direction !== 'output') continue;

      const outputBudget = sourcePort.relationship ?? DEFAULT_PORT_RELATIONSHIP;
      const sourceHandle = portHandleId(sourcePort, sourceIndex);
      let outputEdges = 0;

      for (const target of ordered) {
        if (outputBudget === 'one' && outputEdges > 0) break;
        // A node never wires into itself: `house_fuse` declares `supply` in
        // both directions, and a self-loop there means nothing.
        if (target.instanceId === source.instanceId) continue;

        for (
          let targetIndex = 0;
          targetIndex < target.ports.length;
          targetIndex++
        ) {
          if (outputBudget === 'one' && outputEdges > 0) break;

          const targetPort = target.ports[targetIndex];
          if (targetPort.direction !== 'input') continue;

          const claimKey = budgetKey(target.instanceId, targetIndex);
          const claimed = inputClaims.get(claimKey) ?? 0;
          const inputBudget =
            targetPort.relationship ?? DEFAULT_PORT_RELATIONSHIP;
          if (inputBudget === 'one' && claimed > 0) continue;

          if (!kindsCompatible(sourcePort.kind, targetPort.kind, registry)) {
            continue;
          }
          if (!portFiltersPass(targetPort, source.attributes)) continue;

          const targetHandle = portHandleId(targetPort, targetIndex);
          edges.push({
            id: edgeId(
              source.instanceId,
              sourceHandle,
              target.instanceId,
              targetHandle
            ),
            sourceInstanceId: source.instanceId,
            sourcePortName: sourceHandle,
            targetInstanceId: target.instanceId,
            targetPortName: targetHandle,
            kind: sourcePort.kind,
            origin: 'derived',
          });

          inputClaims.set(claimKey, claimed + 1);
          outputEdges++;
        }
      }
    }
  }

  return edges;
}

function edgeId(
  sourceInstanceId: string,
  sourceHandle: string,
  targetInstanceId: string,
  targetHandle: string
): string {
  return `edge-${sourceInstanceId}-${sourceHandle}-${targetInstanceId}-${targetHandle}`;
}

// ---------------------------------------------------------------------------
// 4. Overrides
// ---------------------------------------------------------------------------

/** A node, one of its ports, and that port's XYFlow handle id. */
export interface ResolvedEndpoint {
  node: FlatNode;
  port: Port;
  handle: string;
}

function findPort(
  node: FlatNode,
  name: string,
  direction: Port['direction']
): ResolvedEndpoint | null {
  for (let index = 0; index < node.ports.length; index++) {
    const port = node.ports[index];
    if (port.direction === direction && port.name === name) {
      return { node, port, handle: portHandleId(port, index) };
    }
  }
  return null;
}

function compareOverrides(
  left: GraphEdgeOverride,
  right: GraphEdgeOverride
): number {
  return (
    compareStrings(left.sourcePath, right.sourcePath) ||
    compareStrings(left.sourcePort, right.sourcePort) ||
    compareStrings(left.targetPath, right.targetPath) ||
    compareStrings(left.targetPort, right.targetPort)
  );
}

/**
 * Where an override's endpoints land in the current view.
 *
 * `reason` is phrased to complete "the … override … <reason>", so the same
 * string serves the engine's diagnostic and the editor's override panel.
 */
export type OverrideEndpoints =
  | { ok: true; source: ResolvedEndpoint; target: ResolvedEndpoint }
  | { ok: false; reason: string };

/**
 * Resolve an override's stored endpoints against the flattened nodes.
 *
 * Exported because the editor needs to show which overrides have gone stale,
 * and re-deriving that in the UI would be a second implementation of a rule
 * that has to agree with this one exactly. Note the asymmetry it papers over:
 * an override stores **bare port names**, while a `FlatEdge` carries handle
 * ids — `findPort` is what converts between them.
 */
export function resolveOverrideEndpoints(
  byInstance: ReadonlyMap<string, FlatNode>,
  override: GraphEdgeOverride
): OverrideEndpoints {
  const sourceNode = byInstance.get(override.sourcePath);
  const targetNode = byInstance.get(override.targetPath);
  if (!sourceNode || !targetNode) {
    return { ok: false, reason: 'names a node that is not in this graph' };
  }

  const source = findPort(sourceNode, override.sourcePort, 'output');
  const target = findPort(targetNode, override.targetPort, 'input');
  if (!source || !target) {
    return { ok: false, reason: 'names a port that no longer exists' };
  }

  return { ok: true, source, target };
}

/** Index flattened nodes by instance id — the key overrides address them by. */
export function indexByInstance(
  nodes: readonly FlatNode[]
): Map<string, FlatNode> {
  return new Map(nodes.map((node) => [node.instanceId, node]));
}

function staleDiagnostic(
  override: GraphEdgeOverride,
  reason: string
): GraphDiagnostic {
  return {
    level: 'warning',
    code: 'stale-override',
    message: `The ${override.mode} override ${override.sourcePath}:${override.sourcePort} → ${override.targetPath}:${override.targetPort} ${reason}.`,
    instanceId: override.sourcePath,
  };
}

/**
 * Patch the derived wiring with the root graph's `pin` / `suppress` records.
 *
 * Suppressions run first, then pins, each in a fixed endpoint order — the
 * result must not depend on the order the records came back in.
 *
 * Removing an edge deliberately does **not** re-run matching. Freeing a `one`
 * input does not hand the slot to the runner-up; suppression removes an edge,
 * it does not reopen the auction. Single-pass keeps the picture predictable.
 *
 * `reportStale` is switched off for focused views, where an override
 * legitimately addresses a node that is simply out of frame.
 */
export function applyOverrides(
  nodes: readonly FlatNode[],
  edges: readonly FlatEdge[],
  overrides: readonly GraphEdgeOverride[],
  reportStale = true
): { edges: FlatEdge[]; diagnostics: GraphDiagnostic[] } {
  const byInstance = indexByInstance(nodes);
  const result = [...edges];
  const diagnostics: GraphDiagnostic[] = [];

  const stale = (override: GraphEdgeOverride, reason: string) => {
    if (reportStale) diagnostics.push(staleDiagnostic(override, reason));
  };

  const endpointsFor = (
    override: GraphEdgeOverride
  ): { source: ResolvedEndpoint; target: ResolvedEndpoint } | null => {
    const resolved = resolveOverrideEndpoints(byInstance, override);
    if (!resolved.ok) {
      stale(override, resolved.reason);
      return null;
    }

    return { source: resolved.source, target: resolved.target };
  };

  const sorted = [...overrides].sort(compareOverrides);

  for (const override of sorted.filter((row) => row.mode === 'suppress')) {
    const endpoints = endpointsFor(override);
    if (!endpoints) continue;

    const index = result.findIndex(
      (edge) =>
        edge.origin === 'derived' &&
        edge.sourceInstanceId === endpoints.source.node.instanceId &&
        edge.sourcePortName === endpoints.source.handle &&
        edge.targetInstanceId === endpoints.target.node.instanceId &&
        edge.targetPortName === endpoints.target.handle
    );

    if (index === -1) {
      stale(override, 'matched no derived edge');
      continue;
    }

    result.splice(index, 1);
  }

  for (const override of sorted.filter((row) => row.mode === 'pin')) {
    const endpoints = endpointsFor(override);
    if (!endpoints) continue;

    const { source, target } = endpoints;
    const id = edgeId(
      source.node.instanceId,
      source.handle,
      target.node.instanceId,
      target.handle
    );
    if (result.some((edge) => edge.id === id)) continue;

    result.push({
      id,
      sourceInstanceId: source.node.instanceId,
      sourcePortName: source.handle,
      targetInstanceId: target.node.instanceId,
      targetPortName: target.handle,
      kind: source.port.kind,
      origin: 'pinned',
    });
  }

  return { edges: result, diagnostics };
}

// ---------------------------------------------------------------------------
// 5. Validate
// ---------------------------------------------------------------------------

/**
 * Diagnostics that fall out of the finished wiring.
 *
 * A pinned edge satisfies a required input — it is still an edge, and the user
 * put it there deliberately.
 */
export function validateGraph(
  nodes: readonly FlatNode[],
  edges: readonly FlatEdge[],
  registry?: PortKindRegistry
): GraphDiagnostic[] {
  const connected = new Set(
    edges.map((edge) => `${edge.targetInstanceId}#${edge.targetPortName}`)
  );

  const diagnostics: GraphDiagnostic[] = [];
  const reportedKinds = new Set<string>();

  for (const node of nodes) {
    for (let index = 0; index < node.ports.length; index++) {
      const port = node.ports[index];

      if (registry && !registry[port.kind]) {
        const key = `${node.instanceId}#${port.kind}`;
        if (!reportedKinds.has(key)) {
          reportedKinds.add(key);
          diagnostics.push({
            level: 'info',
            code: 'unknown-port-kind',
            message: `Port kind "${port.kind}" on ${node.label} has no registry entry; it will render with the fallback colour.`,
            instanceId: node.instanceId,
            path: node.breadcrumb,
          });
        }
      }

      if (port.direction !== 'input' || !port.isRequired) continue;

      const handle = `${node.instanceId}#${portHandleId(port, index)}`;
      if (connected.has(handle)) continue;

      diagnostics.push({
        level: 'error',
        code: 'required-input-unconnected',
        message: `Required input "${port.name}" on ${node.label} has no connection.`,
        instanceId: node.instanceId,
        path: node.breadcrumb,
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** Run the whole pipeline over a resolved tree. */
export function buildGraphView(
  root: ResolvedGraph,
  options: EngineOptions = {}
): GraphView {
  const focus = options.focus ?? [];
  const flattenDiagnostics: GraphDiagnostic[] = [];
  const nodes = focusNodes(flattenGraph(root, flattenDiagnostics), focus);
  const derived = connectNodes(nodes, options.portKinds);

  const { edges, diagnostics: overrideDiagnostics } = applyOverrides(
    nodes,
    derived,
    options.overrides ?? [],
    focus.length === 0
  );

  return {
    nodes,
    edges,
    diagnostics: [
      ...(options.diagnostics ?? []),
      ...flattenDiagnostics,
      ...overrideDiagnostics,
      ...validateGraph(nodes, edges, options.portKinds),
    ],
    positions:
      options.layout === false ? {} : layoutGraph(nodes, edges, options.layout),
  };
}
