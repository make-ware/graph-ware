// Engine output → XYFlow input.
//
// Pure on purpose: no React, no DOM, no PocketBase. The canvas is a thin shell
// around these two functions, which is what lets the interesting behaviour
// (handle addressing, colour resolution, selection) be tested without mounting
// ReactFlow — it measures the DOM, and happy-dom has no ResizeObserver.
//
// Reference: docs/GRAPH_ENGINE.md

import { type Edge, type Node, Position } from '@xyflow/react';
import { INSTANCE_PATH_SEPARATOR } from './primitives';
import { portHandleId } from './engine';
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from './layout';
import type { FlatEdge, FlatNode, GraphView } from './types';

// ---------------------------------------------------------------------------
// Node data
// ---------------------------------------------------------------------------

/**
 * What the custom node component receives.
 *
 * `Record<string, unknown>` is XYFlow's constraint on node data, so the shape
 * is spelled out as an interface and widened at the call site rather than
 * loosened here.
 */
export interface GraphNodeData extends Record<string, unknown> {
  node: FlatNode;
  /** Split out so the component does not re-filter ports on every render. */
  inputs: PortSlot[];
  outputs: PortSlot[];
}

/** A port paired with the handle id the engine derived edges against. */
export interface PortSlot {
  handleId: string;
  /** Index into `FlatNode.ports` — the engine's port identity. */
  index: number;
  port: FlatNode['ports'][number];
}

export const GRAPH_NODE_TYPE = 'graphNode';

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * Split a node's ports into input and output slots, preserving the original
 * index — `portHandleId` keys off position in `ports`, not off the filtered
 * list, so filtering first and indexing after would produce handles that no
 * edge points at.
 */
export function toPortSlots(node: FlatNode): {
  inputs: PortSlot[];
  outputs: PortSlot[];
} {
  const inputs: PortSlot[] = [];
  const outputs: PortSlot[] = [];

  for (let index = 0; index < node.ports.length; index++) {
    const port = node.ports[index];
    const slot: PortSlot = { handleId: portHandleId(port, index), index, port };
    if (port.direction === 'input') inputs.push(slot);
    else outputs.push(slot);
  }

  return { inputs, outputs };
}

/**
 * One XYFlow node per flat node, positioned from the engine's layout pass.
 *
 * A node the layout has no entry for falls back to the origin rather than
 * being dropped — an unpositioned node visible in a pile is debuggable, a
 * missing one is not.
 */
export function toFlowNodes(view: GraphView): Node<GraphNodeData>[] {
  return view.nodes.map((node) => {
    const { inputs, outputs } = toPortSlots(node);

    return {
      id: node.instanceId,
      type: GRAPH_NODE_TYPE,
      position: view.positions[node.instanceId] ?? { x: 0, y: 0 },
      data: { node, inputs, outputs },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      // Declared rather than measured, for two reasons: dagre already laid the
      // graph out against exactly these numbers, and the canvas is controlled
      // without an `onNodesChange` handler — so XYFlow cannot write measured
      // dimensions back onto these objects, and anything reading them off the
      // node (the minimap) would see nothing at all.
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
    };
  });
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * Edges coloured by port kind, with pinned ones drawn dashed.
 *
 * `FlatEdge.sourcePortName` / `targetPortName` are already handle ids (the
 * engine builds them with `portHandleId`), so they pass straight through.
 * Colour is resolved through the caller's `colorFor`, which comes from
 * `usePortKinds` — nothing here knows a hex value.
 */
export function toFlowEdges(
  view: GraphView,
  colorFor: (kind: string) => string
): Edge[] {
  return view.edges.map((edge) => {
    const color = colorFor(edge.kind);

    return {
      id: edge.id,
      source: edge.sourceInstanceId,
      sourceHandle: edge.sourcePortName,
      target: edge.targetInstanceId,
      targetHandle: edge.targetPortName,
      style: {
        stroke: color,
        strokeWidth: 2,
        strokeDasharray: edge.origin === 'pinned' ? '6 4' : undefined,
      },
      data: { kind: edge.kind, origin: edge.origin },
    } satisfies Edge;
  });
}

/** Look an edge back up by the id XYFlow hands to `onEdgeClick`. */
export function findEdge(view: GraphView, edgeId: string): FlatEdge | null {
  return view.edges.find((edge) => edge.id === edgeId) ?? null;
}

/** Look a node back up by its instance id. */
export function findNode(view: GraphView, instanceId: string): FlatNode | null {
  return view.nodes.find((node) => node.instanceId === instanceId) ?? null;
}

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

/** What is selected on the canvas, as encoded in the query string. */
export type ViewerSelection =
  { type: 'node'; instanceId: string } | { type: 'edge'; edgeId: string };

export interface ViewerParams {
  /** Instance path from `?focus`; empty means the whole tree. */
  focus: string[];
  selection: ViewerSelection | null;
}

export const FOCUS_PARAM = 'focus';
export const NODE_PARAM = 'node';
export const EDGE_PARAM = 'edge';

/**
 * Read focus and selection out of the query string.
 *
 * Kept pure and separate from the components because `next/navigation` is
 * mocked globally in `src/test/setup.ts` with a fixed empty `useSearchParams`;
 * testing the parser directly beats fighting that mock.
 *
 * `?node` wins over `?edge` when both are present — the canvas only ever sets
 * one, so a URL carrying both was hand-edited and needs a deterministic answer
 * rather than an error.
 */
export function parseViewerParams(params: URLSearchParams): ViewerParams {
  const focus = parseInstancePathParam(params.get(FOCUS_PARAM));

  const node = params.get(NODE_PARAM)?.trim();
  if (node) return { focus, selection: { type: 'node', instanceId: node } };

  const edge = params.get(EDGE_PARAM)?.trim();
  if (edge) return { focus, selection: { type: 'edge', edgeId: edge } };

  return { focus, selection: null };
}

/** `"port_bank/cells"` → `["port_bank", "cells"]`; blank or missing → `[]`. */
export function parseInstancePathParam(value: string | null): string[] {
  if (!value) return [];

  return value
    .split(INSTANCE_PATH_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** The inverse, for building links. Empty path → `null` (drop the param). */
export function formatInstancePathParam(
  path: readonly string[]
): string | null {
  return path.length ? path.join(INSTANCE_PATH_SEPARATOR) : null;
}

/**
 * Apply focus and selection to a query string, dropping empties.
 *
 * Returns a new `URLSearchParams` so callers can preserve anything else that
 * happens to be on the URL.
 */
export function writeViewerParams(
  current: URLSearchParams,
  next: ViewerParams
): URLSearchParams {
  const params = new URLSearchParams(current);

  const focus = formatInstancePathParam(next.focus);
  if (focus) params.set(FOCUS_PARAM, focus);
  else params.delete(FOCUS_PARAM);

  params.delete(NODE_PARAM);
  params.delete(EDGE_PARAM);

  if (next.selection?.type === 'node') {
    params.set(NODE_PARAM, next.selection.instanceId);
  } else if (next.selection?.type === 'edge') {
    params.set(EDGE_PARAM, next.selection.edgeId);
  }

  return params;
}
