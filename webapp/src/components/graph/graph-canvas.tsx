'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  type ColorMode,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeChange,
  ReactFlow,
} from '@xyflow/react';
import { useTheme } from 'next-themes';
import type { FlatNode, GraphView, NodePosition } from '@project/shared';
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
  /**
   * Persist a dragged node's position. Omitted — the viewer's case — leaves the
   * canvas read-only, exactly as it was before drag existed.
   */
  onNodeMoved?: (instanceId: string, position: NodePosition) => void;
  /**
   * Which nodes may be dragged. Only root-graph nodes qualify: `position` is
   * stored on the `GraphNodes` record, so a node imported twice would report
   * one position under two instance ids. The engine already declines to honour
   * a position below the root for that reason — this mirrors it rather than
   * offering a gesture whose result would be discarded.
   */
  canDragNode?: (node: FlatNode) => boolean;
}

/**
 * The canvas.
 *
 * Takes engine output as props rather than reading the viewer context, so it
 * can be rendered from a fixture with no PocketBase anywhere in the picture.
 *
 * Read-only unless `onNodeMoved` is supplied. XYFlow only drags a controlled
 * node when an `onNodesChange` handler exists, so the editor's positions are
 * held in a local overlay during the drag and released once the resolved view
 * reports the same coordinates — without it the node snaps back to its old
 * spot for as long as the write is in flight.
 */
export function GraphCanvas({
  view,
  colorFor,
  selection,
  onSelect,
  onNodeMoved,
  canDragNode,
}: GraphCanvasProps) {
  const isEditable = Boolean(onNodeMoved);

  // XYFlow ships its own light/dark stylesheet for the controls and handles,
  // which is keyed off this prop rather than the `.dark` class. `theme` is the
  // stored preference, so 'system' passes straight through to XYFlow's own
  // media query; it is undefined until next-themes hydrates.
  const { theme } = useTheme();

  // Where a node sits *during* a drag. XYFlow will not move a controlled node
  // on its own, so without this it stays put under the cursor.
  //
  // Cleared at drag stop rather than reconciled against the resolved view: the
  // editor applies the new position optimistically before it writes, so the
  // view already agrees by the time this empties. Keeping entries past drag
  // stop would also outlive "reset layout", pinning nodes to coordinates the
  // record no longer has.
  const [dragged, setDragged] = useState<Record<string, NodePosition>>({});

  const nodes = useMemo<Node<GraphNodeData>[]>(() => {
    const selectedId = selection?.type === 'node' ? selection.instanceId : null;

    return toFlowNodes(view).map((node) => {
      const pending = dragged[node.id];
      return {
        ...node,
        position: pending ?? node.position,
        selected: node.id === selectedId,
        draggable: isEditable && (canDragNode?.(node.data.node) ?? true),
        // `colorFor` rides along on the node data because XYFlow constructs node
        // components itself and there is no prop channel into them.
        data: { ...node.data, colorFor },
      };
    });
  }, [view, colorFor, selection, dragged, isEditable, canDragNode]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<GraphNodeData>>[]) => {
      const moves = changes.filter(
        (change) => change.type === 'position' && change.position
      );
      if (!moves.length) return;

      setDragged((current) => {
        const next = { ...current };
        for (const change of moves) {
          if (change.type !== 'position' || !change.position) continue;
          next[change.id] = change.position;
        }
        return next;
      });
    },
    []
  );

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
      colorMode={(theme as ColorMode) ?? 'system'}
      nodesDraggable={isEditable}
      // There is no "connect" gesture in this app, in either mode. Wiring is
      // derived from ports; dragging a handle would imply a stored edge.
      nodesConnectable={false}
      elementsSelectable
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      onNodesChange={isEditable ? onNodesChange : undefined}
      onNodeDragStop={(_, node) => {
        const position = dragged[node.id] ?? node.position;
        setDragged((current) => {
          if (!(node.id in current)) return current;
          const next = { ...current };
          delete next[node.id];
          return next;
        });
        onNodeMoved?.(node.id, {
          x: Math.round(position.x),
          y: Math.round(position.y),
        });
      }}
      onNodeClick={(_, node) => onSelect({ type: 'node', instanceId: node.id })}
      onEdgeClick={(_, edge) => onSelect({ type: 'edge', edgeId: edge.id })}
      onPaneClick={() => onSelect(null)}
    >
      <Background />
      {/* XYFlow's default control buttons are ~16px — fine for a mouse, not for
          a thumb. */}
      <Controls showInteractive={false} className="[&_button]:size-8" />
      {/* The minimap paints its own opaque background, which ignores the theme
          unless it is given one — hence the explicit tokens.

          Hidden below `md`: on a phone it covers a large share of a canvas that
          is already the whole viewport, and pinch-zoom gives the same overview
          for free. */}
      <MiniMap
        pannable
        zoomable
        className="border-border !hidden rounded-md border bg-[var(--card)]! md:!block"
        maskColor="color-mix(in oklch, var(--muted) 70%, transparent)"
        nodeClassName={(node) =>
          subgraphFillClass((node.data as GraphNodeData).node.graphColorIndex)
        }
      />
    </ReactFlow>
  );
}
