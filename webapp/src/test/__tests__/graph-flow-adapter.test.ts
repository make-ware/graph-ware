import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import {
  FALLBACK_PORT_KIND_COLOR,
  buildGraphView,
  portHandleId,
} from '@project/shared';
import {
  GRAPH_NODE_TYPE,
  findEdge,
  findNode,
  toFlowEdges,
  toFlowNodes,
  toPortSlots,
} from '@/lib/graph/flow-adapter';
import { SAMPLE_PORT_KINDS, sampleTree } from './fixtures/graph-fixtures';

const COLORS: Record<string, string> = {
  power: '#f59e0b',
  'data/canbus': '#06b6d4',
  'data/vbus': '#10b981',
  'video/hdmi': '#a855f7',
};

const colorFor = (kind: string) => COLORS[kind] ?? FALLBACK_PORT_KIND_COLOR;

function view() {
  return buildGraphView(sampleTree(), { portKinds: SAMPLE_PORT_KINDS });
}

describe('toPortSlots', () => {
  it('keeps the original port index so handle ids match the engine', () => {
    // `house_fuse` has `supply` as both an input and an output; indexing the
    // filtered lists instead of the original array would collide them.
    const fuse = view().nodes.find((node) => node.name === 'house_fuse');
    expect(fuse).toBeDefined();

    const { inputs, outputs } = toPortSlots(fuse!);

    for (const slot of [...inputs, ...outputs]) {
      expect(slot.handleId).toBe(
        portHandleId(fuse!.ports[slot.index], slot.index)
      );
      expect(fuse!.ports[slot.index]).toBe(slot.port);
    }

    expect(inputs).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    expect(inputs[0].handleId).not.toBe(outputs[0].handleId);
  });

  it('sorts every port into exactly one direction', () => {
    for (const node of view().nodes) {
      const { inputs, outputs } = toPortSlots(node);
      expect(inputs.length + outputs.length).toBe(node.ports.length);
      expect(inputs.every((slot) => slot.port.direction === 'input')).toBe(
        true
      );
      expect(outputs.every((slot) => slot.port.direction === 'output')).toBe(
        true
      );
    }
  });
});

describe('toFlowNodes', () => {
  it('maps one XYFlow node per flat node, keyed by instance id', () => {
    const current = view();
    const nodes = toFlowNodes(current);

    expect(nodes).toHaveLength(current.nodes.length);
    expect(nodes.map((node) => node.id).sort()).toEqual(
      current.nodes.map((node) => node.instanceId).sort()
    );
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    expect(nodes.every((node) => node.type === GRAPH_NODE_TYPE)).toBe(true);
  });

  it('takes positions from the engine layout', () => {
    const current = view();

    for (const node of toFlowNodes(current)) {
      expect(node.position).toEqual(current.positions[node.id]);
    }
  });

  it('puts inputs on the left and outputs on the right', () => {
    for (const node of toFlowNodes(view())) {
      expect(node.targetPosition).toBe(Position.Left);
      expect(node.sourcePosition).toBe(Position.Right);
    }
  });

  it('falls back to the origin rather than dropping an unpositioned node', () => {
    const current = buildGraphView(sampleTree(), {
      portKinds: SAMPLE_PORT_KINDS,
      layout: false,
    });

    const nodes = toFlowNodes(current);
    expect(nodes).toHaveLength(current.nodes.length);
    expect(
      nodes.every((node) => node.position.x === 0 && node.position.y === 0)
    ).toBe(true);
  });
});

describe('toFlowEdges', () => {
  it('points every endpoint at a handle that actually exists', () => {
    const current = view();
    const handles = new Map(
      current.nodes.map((node) => {
        const { inputs, outputs } = toPortSlots(node);
        return [
          node.instanceId,
          new Set([...inputs, ...outputs].map((slot) => slot.handleId)),
        ];
      })
    );

    const edges = toFlowEdges(current, colorFor);
    expect(edges.length).toBeGreaterThan(0);

    for (const edge of edges) {
      expect(handles.get(edge.source)?.has(edge.sourceHandle!)).toBe(true);
      expect(handles.get(edge.target)?.has(edge.targetHandle!)).toBe(true);
    }
  });

  it('colours edges from the port-kind table', () => {
    const current = view();

    for (const edge of toFlowEdges(current, colorFor)) {
      const source = current.edges.find(
        (candidate) => candidate.id === edge.id
      );
      expect(edge.style?.stroke).toBe(colorFor(source!.kind));
    }
  });

  it('uses the fallback colour for an unregistered kind', () => {
    const current = view();
    const edges = toFlowEdges(current, () => FALLBACK_PORT_KIND_COLOR);

    expect(
      edges.every((edge) => edge.style?.stroke === FALLBACK_PORT_KIND_COLOR)
    ).toBe(true);
  });

  it('draws derived edges solid', () => {
    const current = view();
    // Nothing in the sample tree is pinned, so every edge is derived.
    expect(current.edges.every((edge) => edge.origin === 'derived')).toBe(true);
    expect(
      toFlowEdges(current, colorFor).every(
        (edge) => edge.style?.strokeDasharray === undefined
      )
    ).toBe(true);
  });
});

describe('lookups', () => {
  it('finds a node and an edge by id, and returns null otherwise', () => {
    const current = view();

    const node = current.nodes[0];
    expect(findNode(current, node.instanceId)).toBe(node);
    expect(findNode(current, 'nope/nope')).toBeNull();

    const edge = current.edges[0];
    expect(findEdge(current, edge.id)).toBe(edge);
    expect(findEdge(current, 'edge-nope')).toBeNull();
  });
});
