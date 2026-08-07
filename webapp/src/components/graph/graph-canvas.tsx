'use client';

import { useMemo } from 'react';
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
} from '@xyflow/react';
import type { GraphView } from '@project/shared';
import {
  GRAPH_NODE_TYPE,
  type GraphNodeData,
  type ViewerSelection,
  toFlowEdges,
  toFlowNodes,
} from '@/lib/graph/flow-adapter';
import { GraphNode } from './graph-node';
import { subgraphFillClass } from './subgraph-palette';

// Defined once at module scope: XYFlow warns (and remounts every node) if the
// `nodeTypes` object identity changes between renders.
const NODE_TYPES = { [GRAPH_NODE_TYPE]: GraphNode };

interface GraphCanvasProps {
  view: GraphView;
  colorFor: (kind: string) => string;
  selection: ViewerSelection | null;
  onSelect: (selection: ViewerSelection | null) => void;
}

/**
 * The canvas.
 *
 * Takes engine output as props rather than reading the viewer context, so it
 * can be rendered from a fixture with no PocketBase anywhere in the picture.
 *
 * Read-only by construction: no `onNodesChange`/`onEdgesChange` handlers are
 * passed, so XYFlow renders nodes as undraggable and edges as unreconnectable.
 * Phase 4 adds those; until then there is nothing to accidentally persist.
 */
export function GraphCanvas({
  view,
  colorFor,
  selection,
  onSelect,
}: GraphCanvasProps) {
  const nodes = useMemo<Node<GraphNodeData>[]>(() => {
    const selectedId = selection?.type === 'node' ? selection.instanceId : null;

    return toFlowNodes(view).map((node) => ({
      ...node,
      selected: node.id === selectedId,
      draggable: false,
      // `colorFor` rides along on the node data because XYFlow constructs node
      // components itself and there is no prop channel into them.
      data: { ...node.data, colorFor },
    }));
  }, [view, colorFor, selection]);

  const edges = useMemo<Edge[]>(() => {
    const selectedId = selection?.type === 'edge' ? selection.edgeId : null;

    return toFlowEdges(view, colorFor).map((edge) => ({
      ...edge,
      selected: edge.id === selectedId,
      animated: edge.id === selectedId,
    }));
  }, [view, colorFor, selection]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => onSelect({ type: 'node', instanceId: node.id })}
      onEdgeClick={(_, edge) => onSelect({ type: 'edge', edgeId: edge.id })}
      onPaneClick={() => onSelect(null)}
    >
      <Background />
      <Controls showInteractive={false} />
      {/* The minimap paints its own opaque background, which ignores the theme
          unless it is given one — hence the explicit tokens. */}
      <MiniMap
        pannable
        zoomable
        className="rounded-md border border-border bg-[var(--card)]!"
        maskColor="color-mix(in oklch, var(--muted) 70%, transparent)"
        nodeClassName={(node) =>
          subgraphFillClass((node.data as GraphNodeData).node.graphColorIndex)
        }
      />
    </ReactFlow>
  );
}
