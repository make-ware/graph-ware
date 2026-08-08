// Auto-layout for the derived graph.
//
// A thin dagre wrapper, kept separate so the rest of the engine stays free of a
// third-party dependency and so the layout can be swapped (ELK, if a hundred-node
// tree ever needs it) without touching the pipeline.
//
// Reference: docs/GRAPH_ENGINE.md § Layout

import dagre from '@dagrejs/dagre';
import type { NodePosition } from './primitives';
import type { FlatEdge, FlatNode, LayoutOptions } from './types';

/** Fixed node dimensions — the canvas renders every node the same size. */
export const DEFAULT_NODE_WIDTH = 240;
export const DEFAULT_NODE_HEIGHT = 120;
export const DEFAULT_RANK_SEPARATION = 120;
export const DEFAULT_NODE_SEPARATION = 60;

/**
 * Positions for every node, keyed by `instanceId`.
 *
 * Left-to-right ranking, matching the canvas: input handles on the left of a
 * node, outputs on the right.
 *
 * A node with a stored `position` keeps it verbatim. It is still handed to
 * dagre so its neighbours rank around it — "excluded from the auto-layout pass"
 * means auto-layout does not get to decide its coordinates, not that it
 * disappears from the graph.
 *
 * Coordinates are rounded to integers: dagre's float output is stable in
 * practice but comparing whole numbers makes the determinism tests exact.
 */
export function layoutGraph(
  nodes: readonly FlatNode[],
  edges: readonly FlatEdge[],
  options: LayoutOptions = {}
): Record<string, NodePosition> {
  const width = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const height = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;

  // Multigraph: a fuse can feed two inputs on one node, and a simple graph
  // would silently collapse those into one edge and skew the ranking.
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options.rankdir ?? 'LR',
    ranksep: options.ranksep ?? DEFAULT_RANK_SEPARATION,
    nodesep: options.nodesep ?? DEFAULT_NODE_SEPARATION,
  });

  // Insertion order is the caller's order, which is already deterministic.
  for (const node of nodes) {
    graph.setNode(node.instanceId, { width, height });
  }
  for (const edge of edges) {
    if (
      graph.hasNode(edge.sourceInstanceId) &&
      graph.hasNode(edge.targetInstanceId)
    ) {
      graph.setEdge(edge.sourceInstanceId, edge.targetInstanceId, {}, edge.id);
    }
  }

  dagre.layout(graph);

  const positions: Record<string, NodePosition> = {};
  for (const node of nodes) {
    if (node.position) {
      positions[node.instanceId] = { ...node.position };
      continue;
    }

    const laid = graph.node(node.instanceId);
    // Dagre reports centres; XYFlow places nodes by their top-left corner.
    positions[node.instanceId] = {
      x: Math.round(laid.x - width / 2),
      y: Math.round(laid.y - height / 2),
    };
  }

  return positions;
}
