import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  buildGraphView,
  connectNodes,
  flattenGraph,
  layoutGraph,
  type Port,
} from '../../index';
import {
  SAMPLE_PORT_KINDS,
  makeNode,
  resolvedFrom,
  sampleTree,
  shuffleTree,
} from '../fixtures/graph-fixtures';

const out: Port = { name: 'out', direction: 'output', kind: 'power' };
const inp: Port = { name: 'in', direction: 'input', kind: 'power' };

/** `a → b → c`, in a straight line. */
function chain() {
  return resolvedFrom([
    makeNode({ id: 'a', name: 'a', ports: [out] }),
    makeNode({ id: 'b', name: 'b', ports: [inp, out] }),
    makeNode({ id: 'c', name: 'c', ports: [inp] }),
  ]);
}

function layoutOf(graph = chain()) {
  const nodes = flattenGraph(graph);
  return layoutGraph(nodes, connectNodes(nodes, SAMPLE_PORT_KINDS));
}

describe('layoutGraph', () => {
  it('ranks left to right along an edge chain', () => {
    const positions = layoutOf();

    expect(positions.a.x).toBeLessThan(positions.b.x);
    expect(positions.b.x).toBeLessThan(positions.c.x);
  });

  it('places one node per flat node, keyed by instance id', () => {
    const nodes = flattenGraph(sampleTree());
    const positions = layoutGraph(
      nodes,
      connectNodes(nodes, SAMPLE_PORT_KINDS)
    );

    expect(Object.keys(positions).sort()).toEqual(
      nodes.map((node) => node.instanceId).sort()
    );
  });

  it('returns whole numbers, so results compare exactly', () => {
    for (const position of Object.values(layoutOf())) {
      expect(Number.isInteger(position.x)).toBe(true);
      expect(Number.isInteger(position.y)).toBe(true);
    }
  });

  it('converts dagre centres to top-left corners', () => {
    // A lone node sits at dagre's origin: its centre is (w/2, h/2), so its
    // top-left corner is (0, 0).
    const solo = layoutGraph(
      flattenGraph(resolvedFrom([makeNode({ id: 'only', name: 'only' })])),
      []
    );

    expect(solo.only).toEqual({ x: 0, y: 0 });
  });

  it('honours a stored position and lays the rest out around it', () => {
    const graph = chain();
    graph.nodes[1] = makeNode({
      id: 'b',
      name: 'b',
      ports: [inp, out],
      position: { x: -500, y: 900 },
    });

    const positions = layoutOf(graph);

    expect(positions.b).toEqual({ x: -500, y: 900 });
    // `a` and `c` still rank around it rather than piling onto the origin.
    expect(positions.a).not.toEqual(positions.c);
    expect(positions.a.x).toBeLessThan(positions.c.x);
  });

  it('accepts custom dimensions', () => {
    const positions = layoutGraph(
      flattenGraph(resolvedFrom([makeNode({ id: 'only', name: 'only' })])),
      [],
      { nodeWidth: DEFAULT_NODE_WIDTH * 2, nodeHeight: DEFAULT_NODE_HEIGHT * 2 }
    );

    expect(positions.only).toEqual({ x: 0, y: 0 });
  });

  it('is stable across runs and across shuffled input', () => {
    const options = { portKinds: SAMPLE_PORT_KINDS };
    const first = buildGraphView(sampleTree(), options).positions;
    const again = buildGraphView(
      shuffleTree(sampleTree(), 99),
      options
    ).positions;

    expect(again).toEqual(first);
  });
});

describe('buildGraphView layout options', () => {
  it('skips layout entirely when asked', () => {
    const view = buildGraphView(sampleTree(), {
      portKinds: SAMPLE_PORT_KINDS,
      layout: false,
    });

    expect(view.positions).toEqual({});
    expect(view.nodes.length).toBeGreaterThan(0);
  });
});
