// The stored form of an override versus the derived form of an edge.
//
// `FlatEdge` carries XYFlow handle ids (`supply-out-0`); `GraphEdgeOverrides`
// stores bare port names (`supply`). The editor builds overrides from selected
// edges, so it has to convert — and getting it wrong is silent: the row saves
// happily and then matches nothing, surfacing later as a `stale-override`
// warning rather than an error at the point of the mistake.

import { describe, it, expect } from 'vitest';
import {
  applyOverrides,
  connectNodes,
  flattenGraph,
  indexByInstance,
  parsePortHandle,
  portHandleId,
  portNameFromHandle,
  resolveOverrideEndpoints,
  type FlatNode,
  type Port,
} from '../../index';
import {
  SAMPLE_PORT_KINDS,
  makeOverride,
  sampleTree,
} from '../fixtures/graph-fixtures';

const nodes = flattenGraph(sampleTree());
const derived = connectNodes(nodes, SAMPLE_PORT_KINDS);
const byInstance = indexByInstance(nodes);

describe('parsePortHandle', () => {
  it('round-trips every port in the sample tree', () => {
    for (const node of nodes) {
      node.ports.forEach((port, index) => {
        const handle = portHandleId(port, index);
        expect(parsePortHandle(handle)).toEqual({
          direction: port.direction,
          index,
        });
      });
    }
  });

  it('keeps the fuse’s two identically-named ports apart', () => {
    // `house_fuse` declares `supply` as both an output and an input — the case
    // index-based handles exist for.
    const fuse = nodes.find((node) => node.name === 'house_fuse');
    expect(fuse).toBeDefined();

    const output = fuse!.ports.findIndex((port) => port.direction === 'output');
    const input = fuse!.ports.findIndex((port) => port.direction === 'input');
    expect(output).not.toBe(input);

    expect(parsePortHandle(portHandleId(fuse!.ports[output], output))).toEqual({
      direction: 'output',
      index: output,
    });
    expect(parsePortHandle(portHandleId(fuse!.ports[input], input))).toEqual({
      direction: 'input',
      index: input,
    });
  });

  it('survives a port name containing a dash', () => {
    // Port names have no character restriction, so splitting the whole id on
    // `-` would mangle this one.
    const port: Port = {
      name: 'dc-supply',
      direction: 'output',
      kind: 'power',
    };
    const handle = portHandleId(port, 3);

    expect(handle).toBe('dc-supply-out-3');
    expect(parsePortHandle(handle)).toEqual({ direction: 'output', index: 3 });
    expect(
      portNameFromHandle({ ports: [port, port, port, port] }, handle)
    ).toBe('dc-supply');
  });

  it('rejects ids that do not address a port', () => {
    expect(parsePortHandle('supply')).toBeNull();
    expect(parsePortHandle('supply-out')).toBeNull();
    expect(parsePortHandle('supply-sideways-0')).toBeNull();
    expect(parsePortHandle('supply-out-x')).toBeNull();
  });
});

describe('portNameFromHandle', () => {
  it('returns the name for a handle that matches the node', () => {
    for (const node of nodes) {
      node.ports.forEach((port, index) => {
        expect(portNameFromHandle(node, portHandleId(port, index))).toBe(
          port.name
        );
      });
    }
  });

  it('returns null when the node no longer has that port', () => {
    const node: Pick<FlatNode, 'ports'> = {
      ports: [{ name: 'supply', direction: 'output', kind: 'power' }],
    };

    expect(portNameFromHandle(node, 'supply-out-4')).toBeNull();
  });

  it('returns null when the direction disagrees with the id', () => {
    // A port flipped from output to input since the edge was derived.
    const node: Pick<FlatNode, 'ports'> = {
      ports: [{ name: 'supply', direction: 'input', kind: 'power' }],
    };

    expect(portNameFromHandle(node, 'supply-out-0')).toBeNull();
  });
});

describe('an override built from a selected edge', () => {
  // What the override panel does: take a derived edge, convert both handle ids
  // back to bare port names, and store those.
  const overrideFor = (edge: (typeof derived)[number]) => {
    const source = byInstance.get(edge.sourceInstanceId)!;
    const target = byInstance.get(edge.targetInstanceId)!;

    return makeOverride({
      mode: 'suppress',
      sourcePath: edge.sourceInstanceId,
      sourcePort: portNameFromHandle(source, edge.sourcePortName)!,
      targetPath: edge.targetInstanceId,
      targetPort: portNameFromHandle(target, edge.targetPortName)!,
    });
  };

  it('resolves back to the endpoints it came from', () => {
    expect(derived.length).toBeGreaterThan(0);

    for (const edge of derived) {
      const resolved = resolveOverrideEndpoints(byInstance, overrideFor(edge));

      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;

      expect(resolved.source.handle).toBe(edge.sourcePortName);
      expect(resolved.target.handle).toBe(edge.targetPortName);
    }
  });

  it('actually suppresses that edge, with no stale warning', () => {
    for (const edge of derived) {
      const { edges, diagnostics } = applyOverrides(nodes, derived, [
        overrideFor(edge),
      ]);

      expect(diagnostics).toEqual([]);
      expect(edges).toHaveLength(derived.length - 1);
      expect(edges.some((row) => row.id === edge.id)).toBe(false);
    }
  });

  it('goes stale if the handle id is stored verbatim instead', () => {
    // The mistake this whole conversion exists to prevent. Storing the handle
    // as the port name is accepted by the collection and quietly does nothing.
    const edge = derived[0];
    const naive = makeOverride({
      mode: 'suppress',
      sourcePath: edge.sourceInstanceId,
      sourcePort: edge.sourcePortName,
      targetPath: edge.targetInstanceId,
      targetPort: edge.targetPortName,
    });

    const { edges, diagnostics } = applyOverrides(nodes, derived, [naive]);

    expect(edges).toHaveLength(derived.length);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('stale-override');
  });
});
