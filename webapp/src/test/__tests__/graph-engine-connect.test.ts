import { describe, it, expect } from 'vitest';
import {
  buildGraphView,
  connectNodes,
  flattenGraph,
  type Port,
  type PortKindRegistry,
} from '@project/shared';
import {
  SAMPLES,
  SAMPLE_PORT_KINDS,
  makeNode,
  resolvedFrom,
  sampleTree,
  shuffleTree,
} from './fixtures/graph-fixtures';

function port(
  overrides: Partial<Port> & Pick<Port, 'name' | 'direction'>
): Port {
  return { kind: 'power', ...overrides };
}

/** A node with the given ports and, optionally, a voltage. */
function device(name: string, ports: Port[], voltage?: string) {
  return makeNode({
    id: name,
    name,
    label: name,
    ports,
    attributes: voltage
      ? [{ name: 'voltage', value: voltage, kind: 'power' }]
      : [],
  });
}

const edgesOf = (nodes: ReturnType<typeof flattenGraph>) =>
  connectNodes(nodes, SAMPLE_PORT_KINDS);

const nameOf = (instanceId: string) => instanceId.split('/').pop()!;

describe('connectNodes — kind matching', () => {
  it('connects ports of the same kind', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [port({ name: 'out', direction: 'output' })]),
        device('b', [port({ name: 'in', direction: 'input' })]),
      ])
    );

    expect(edgesOf(nodes)).toHaveLength(1);
  });

  it('refuses ports of different kinds', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [port({ name: 'out', direction: 'output' })]),
        device('b', [
          port({ name: 'in', direction: 'input', kind: 'data/canbus' }),
        ]),
      ])
    );

    expect(edgesOf(nodes)).toHaveLength(0);
  });

  it('accepts a kind listed in compatibleWith, from either side', () => {
    const build = (registry: PortKindRegistry) =>
      connectNodes(
        flattenGraph(
          resolvedFrom([
            device('a', [
              port({ name: 'out', direction: 'output', kind: 'power/12v' }),
            ]),
            device('b', [
              port({ name: 'in', direction: 'input', kind: 'power' }),
            ]),
          ])
        ),
        registry
      );

    // Declared on the output's kind…
    expect(
      build({
        'power/12v': { key: 'power/12v', compatibleWith: ['power'] },
        power: { key: 'power' },
      })
    ).toHaveLength(1);

    // …and, symmetrically, on the input's.
    expect(
      build({
        'power/12v': { key: 'power/12v' },
        power: { key: 'power', compatibleWith: ['power/12v'] },
      })
    ).toHaveLength(1);

    expect(
      build({ 'power/12v': { key: 'power/12v' }, power: { key: 'power' } })
    ).toHaveLength(0);
  });

  it('still wires same-kind ports with no registry at all', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [
          port({ name: 'out', direction: 'output', kind: 'exotic' }),
        ]),
        device('b', [port({ name: 'in', direction: 'input', kind: 'exotic' })]),
      ])
    );

    expect(connectNodes(nodes)).toHaveLength(1);
  });
});

describe('connectNodes — relationship budgets', () => {
  const twoInputs = () => [
    device('b', [
      port({ name: 'in', direction: 'input', relationship: 'many' }),
    ]),
    device('c', [
      port({ name: 'in', direction: 'input', relationship: 'many' }),
    ]),
  ];

  it('a `one` output stops after its first edge', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [
          port({ name: 'out', direction: 'output', relationship: 'one' }),
        ]),
        ...twoInputs(),
      ])
    );

    const edges = edgesOf(nodes);
    expect(edges).toHaveLength(1);
    expect(nameOf(edges[0].targetInstanceId)).toBe('b');
  });

  it('a `many` output connects to every match', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [
          port({ name: 'out', direction: 'output', relationship: 'many' }),
        ]),
        ...twoInputs(),
      ])
    );

    expect(edgesOf(nodes)).toHaveLength(2);
  });

  it('a `one` input is claimed by its first connection', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [
          port({ name: 'out', direction: 'output', relationship: 'many' }),
        ]),
        device('b', [
          port({ name: 'out', direction: 'output', relationship: 'many' }),
        ]),
        device('c', [
          port({ name: 'in', direction: 'input', relationship: 'one' }),
        ]),
      ])
    );

    const edges = edgesOf(nodes);
    expect(edges).toHaveLength(1);
    // Contention resolves in name order — `a` reaches it first.
    expect(nameOf(edges[0].sourceInstanceId)).toBe('a');
  });

  it('a `many` input accepts every offer', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [
          port({ name: 'out', direction: 'output', relationship: 'many' }),
        ]),
        device('b', [
          port({ name: 'out', direction: 'output', relationship: 'many' }),
        ]),
        device('c', [
          port({ name: 'in', direction: 'input', relationship: 'many' }),
        ]),
      ])
    );

    expect(edgesOf(nodes)).toHaveLength(2);
  });

  it('treats an absent relationship as `one`', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('a', [port({ name: 'out', direction: 'output' })]),
        ...twoInputs(),
      ])
    );

    expect(edgesOf(nodes)).toHaveLength(1);
  });
});

describe('connectNodes — self edges', () => {
  it('never wires a node into itself', () => {
    // `house_fuse` declares `supply` as both a `many` output and a `many`
    // input of kind `power`; a self-loop there would mean nothing.
    const nodes = flattenGraph(
      resolvedFrom([
        device('fuse', [
          port({ name: 'supply', direction: 'output', relationship: 'many' }),
          port({ name: 'supply', direction: 'input', relationship: 'many' }),
        ]),
      ])
    );

    expect(edgesOf(nodes)).toHaveLength(0);
  });
});

describe('connectNodes — handle ids', () => {
  it('numbers handles by their position in the node’s port list', () => {
    const nodes = flattenGraph(
      resolvedFrom([
        device('fuse', [
          port({ name: 'supply', direction: 'output', relationship: 'many' }),
          port({ name: 'supply', direction: 'input', relationship: 'many' }),
        ]),
        device('battery', [port({ name: 'supply', direction: 'output' })]),
      ])
    );

    const edge = edgesOf(nodes).find(
      (candidate) => nameOf(candidate.sourceInstanceId) === 'battery'
    )!;

    expect(edge.sourcePortName).toBe('supply-out-0');
    expect(edge.targetPortName).toBe('supply-in-1');
    expect(edge.id).toBe(`edge-battery-supply-out-0-fuse-supply-in-1`);
  });
});

describe('the sample tree', () => {
  const tree = sampleTree();
  const nodes = flattenGraph(tree);
  const edges = edgesOf(nodes);

  const from = (name: string, alias?: string) =>
    edges.filter(
      (edge) =>
        nameOf(edge.sourceInstanceId) ===
          SAMPLES.BatterySystem.elements.find((el) => el.name === name)?.id &&
        (!alias || edge.sourceInstanceId.startsWith(`${alias}/`))
    );

  it('fans the fuse out to every compatible input', () => {
    // port_bank's fuse is `many` out: it reaches starboard's fuse input and
    // the Cerbo GX.
    expect(from('house_fuse', 'port_bank')).toHaveLength(2);
  });

  it('stops each battery after one edge', () => {
    expect(from('house_battery_1', 'port_bank')).toHaveLength(1);
    expect(from('house_battery_2', 'starboard_bank')).toHaveLength(1);
  });

  it('gives the Cerbo GX exactly one supply, resolved by name order', () => {
    const cerbo = nodes.find((node) => node.name === 'victron_cerbo')!;
    const incoming = edges.filter(
      (edge) => edge.targetInstanceId === cerbo.instanceId
    );

    expect(incoming).toHaveLength(1);
    // Its `supply` input is `one`; port_bank's fuse sorts first and claims it.
    expect(incoming[0].sourceInstanceId.startsWith('port_bank/')).toBe(true);
  });

  it('refuses a source outside the voltage window', () => {
    const highVoltage = {
      ...tree,
      children: tree.children.map((child) => ({
        ...child,
        graph: {
          ...child.graph,
          nodes: child.graph.nodes.map((node) => ({
            ...node,
            attributes: node.attributes?.map((attribute) =>
              attribute.name === 'voltage'
                ? { ...attribute, value: '24' }
                : attribute
            ),
          })),
        },
      })),
    };

    const cerbo = flattenGraph(highVoltage).find(
      (node) => node.name === 'victron_cerbo'
    )!;
    const incoming = edgesOf(flattenGraph(highVoltage)).filter(
      (edge) => edge.targetInstanceId === cerbo.instanceId
    );

    expect(incoming).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('produces byte-identical output for shuffled input', () => {
    const options = { portKinds: SAMPLE_PORT_KINDS };
    const baseline = buildGraphView(sampleTree(), options);

    for (const seed of [1, 42, 1337, 90210]) {
      const shuffled = buildGraphView(shuffleTree(sampleTree(), seed), options);
      expect(JSON.stringify(shuffled)).toBe(JSON.stringify(baseline));
    }
  });
});
