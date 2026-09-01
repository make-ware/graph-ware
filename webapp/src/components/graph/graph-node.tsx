'use client';

import { memo } from 'react';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Lock } from 'lucide-react';
import { formatInstancePath } from '@project/shared';
import type { GraphNodeData, PortSlot } from '@/lib/graph/flow-adapter';
import { cn } from '@/lib/utils';
import { PortBadge } from './port-badge';
import { subgraphColor, subgraphTint } from './subgraph-palette';
import { usePortKindColor } from './port-kind-color-context';

export interface GraphNodeExtras {
  colorFor?: (kind: string) => string;
}

type GraphNodeProps = NodeProps & {
  data: GraphNodeData & Partial<GraphNodeExtras>;
};

/** Fits two rows inside `DEFAULT_NODE_HEIGHT` without clipping a chip. */
const MAX_VISIBLE_PORTS = 4;

function handleStyle(color: string): React.CSSProperties {
  return {
    background: color,
    width: 9,
    height: 9,
    border: '1px solid var(--background)',
  };
}

/**
 * Handles are positioned by even division rather than by matching the visual
 * row of the port chip: chips wrap and the node has a fixed height, so pinning
 * a handle to its chip would drift the moment a label got longer. Even spacing
 * is stable and still reads left-to-right.
 */
function handleOffset(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

function PortHandles({
  slots,
  position,
  colorFor,
}: {
  slots: PortSlot[];
  position: Position;
  colorFor: (kind: string) => string;
}) {
  return (
    <>
      {slots.map((slot, index) => (
        <Handle
          key={slot.handleId}
          id={slot.handleId}
          type={position === Position.Left ? 'target' : 'source'}
          position={position}
          style={{
            ...handleStyle(colorFor(slot.port.kind)),
            top: handleOffset(index, slots.length),
          }}
        />
      ))}
    </>
  );
}

/**
 * A component on the canvas.
 *
 * Inputs on the left, outputs on the right, matching the engine's `LR` dagre
 * layout. The border and tint come from `graphColorIndex`, so two instances of
 * the same imported graph are visually distinct.
 */
function GraphNodeComponent({ data, selected }: GraphNodeProps) {
  const { node, inputs, outputs } = data;
  const contextColorFor = usePortKindColor();
  const colorFor = data.colorFor ?? contextColorFor;
  const accent = subgraphColor(node.graphColorIndex);

  // The root graph's own nodes have an empty instance path; everything else
  // shows where it came from.
  const origin = node.instancePath.length
    ? formatInstancePath(node.instancePath)
    : node.graphLabel;

  // The box is a fixed size because dagre laid the graph out against those
  // exact dimensions, so a long port list is truncated rather than allowed to
  // grow the box and overlap its neighbours. Every port still gets a handle,
  // and the detail panel lists them all. Truncating only pays off if the "+N"
  // chip is smaller than what it replaces, so a list that fits is left alone.
  const overflows = node.ports.length > MAX_VISIBLE_PORTS;
  const visiblePorts = overflows
    ? node.ports.slice(0, MAX_VISIBLE_PORTS - 1)
    : node.ports;
  const hiddenPortCount = node.ports.length - visiblePorts.length;

  const isChildNode = node.instancePath.length > 0;

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-1 rounded-lg border-2 p-2 shadow-sm transition-shadow',
        selected && 'ring-2 ring-ring ring-offset-1',
        isChildNode && 'opacity-90'
      )}
      // The box size comes from the node's declared width/height, which XYFlow
      // applies to the wrapper — matching what dagre laid out against.
      style={{
        borderColor: accent,
        backgroundColor: subgraphTint(node.graphColorIndex),
      }}
    >
      <PortHandles
        slots={inputs}
        position={Position.Left}
        colorFor={colorFor}
      />

      <div className="min-w-0">
        <div
          className="flex items-center gap-1 truncate text-sm font-semibold"
          title={node.label}
        >
          {isChildNode && (
            <Lock
              className="h-3 w-3 shrink-0 text-muted-foreground"
              aria-label="Read-only"
            />
          )}
          <span className="truncate">{node.label}</span>
        </div>
        <div
          className="truncate text-[10px] text-muted-foreground"
          title={origin}
        >
          {origin}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-hidden">
        {visiblePorts.map((port, index) => (
          <PortBadge
            key={`${port.direction}-${port.name}-${index}`}
            port={port}
            color={colorFor(port.kind)}
            showDirection
          />
        ))}
        {hiddenPortCount > 0 && (
          <span
            className="inline-flex items-center rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground"
            title={`${hiddenPortCount} more port${hiddenPortCount === 1 ? '' : 's'} — open the detail panel to see them all`}
          >
            +{hiddenPortCount}
          </span>
        )}
      </div>

      <PortHandles
        slots={outputs}
        position={Position.Right}
        colorFor={colorFor}
      />
    </div>
  );
}

export const GraphNode = memo(GraphNodeComponent);
