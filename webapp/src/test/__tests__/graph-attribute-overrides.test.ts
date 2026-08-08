import { describe, it, expect } from 'vitest';
import {
  buildGraphView,
  buildInstanceId,
  flattenGraph,
  type AttributeOverrideMap,
  type GraphDiagnostic,
  type Port,
  type ResolvedGraph,
} from '@project/shared';
import {
  SAMPLE_PORT_KINDS,
  makeNode,
  resolvedFrom,
} from './fixtures/graph-fixtures';

// The acceptance case in prose: `port_bank` and `starboard_bank` are the same
// `BatterySystem` record under two aliases, and one of them runs at 24 V. The
// override has to reach the *attribute* — so the panel shows 24 — and reach it
// early enough that a filtered input port sees 24 too.

function port(
  overrides: Partial<Port> & Pick<Port, 'name' | 'direction'>
): Port {
  return { kind: 'power', ...overrides };
}

const BATTERY = makeNode({
  id: 'battery',
  name: 'battery',
  label: 'Battery',
  attributes: [
    { name: 'voltage', value: '12', kind: 'power' },
    { name: 'capacity', value: '200', unit: 'Ah', kind: 'power' },
  ],
  ports: [port({ name: 'supply', direction: 'output', relationship: 'many' })],
});

/** A bank graph with one battery, imported twice under the two aliases. */
function twoBanks(overrides: Partial<Record<string, AttributeOverrideMap>>) {
  const bank: ResolvedGraph = {
    id: 'bank',
    uid: 'BatterySystem',
    name: 'battery_system',
    label: 'Battery System',
    nodes: [BATTERY],
    children: [],
  };

  return resolvedFrom([], {
    children: [
      {
        alias: 'port_bank',
        label: 'Port Battery Bank',
        attributeOverrides: overrides.port_bank,
        graph: bank,
      },
      {
        alias: 'starboard_bank',
        label: 'Starboard Battery Bank',
        attributeOverrides: overrides.starboard_bank,
        graph: bank,
      },
    ],
  });
}

const voltageOf = (
  nodes: ReturnType<typeof flattenGraph>,
  alias: string
): string | undefined =>
  nodes
    .find((node) => node.instancePath[0] === alias)!
    .attributes.find((attribute) => attribute.name === 'voltage')?.value;

describe('flattenGraph — per-import attribute overrides', () => {
  it('applies an override to one instance and leaves the other alone', () => {
    const nodes = flattenGraph(
      twoBanks({ starboard_bank: { battery: { voltage: '24' } } })
    );

    expect(voltageOf(nodes, 'port_bank')).toBe('12');
    expect(voltageOf(nodes, 'starboard_bank')).toBe('24');
  });

  it('leaves the stored record untouched', () => {
    flattenGraph(twoBanks({ starboard_bank: { battery: { voltage: '24' } } }));

    // The override must not write through to the shared `GraphNodes` record —
    // both aliases resolve to the *same* object, so a mutation here would leak
    // into every other instance and survive into the next render.
    expect(BATTERY.attributes?.[0].value).toBe('12');
  });

  it('leaves attributes it does not name alone', () => {
    const nodes = flattenGraph(
      twoBanks({ starboard_bank: { battery: { voltage: '24' } } })
    );
    const starboard = nodes.find(
      (node) => node.instancePath[0] === 'starboard_bank'
    )!;

    expect(
      starboard.attributes.find((attribute) => attribute.name === 'capacity')
        ?.value
    ).toBe('200');
  });

  it('never introduces an attribute the node does not have', () => {
    const diagnostics: GraphDiagnostic[] = [];
    const nodes = flattenGraph(
      twoBanks({ starboard_bank: { battery: { chemistry: 'LiFePO4' } } }),
      diagnostics
    );
    const starboard = nodes.find(
      (node) => node.instancePath[0] === 'starboard_bank'
    )!;

    expect(
      starboard.attributes.some((attribute) => attribute.name === 'chemistry')
    ).toBe(false);
    expect(diagnostics.map((entry) => entry.code)).toEqual([
      'stale-attribute-override',
    ]);
  });

  it('reports an override that names a node in no subtree', () => {
    const diagnostics: GraphDiagnostic[] = [];
    flattenGraph(
      twoBanks({ port_bank: { nonesuch: { voltage: '24' } } }),
      diagnostics
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('stale-attribute-override');
    expect(diagnostics[0].message).toContain('nonesuch');
  });

  it('says nothing when every key matches', () => {
    const diagnostics: GraphDiagnostic[] = [];
    flattenGraph(
      twoBanks({ starboard_bank: { battery: { voltage: '24' } } }),
      diagnostics
    );

    expect(diagnostics).toEqual([]);
  });
});

describe('flattenGraph — nested override scopes', () => {
  /** root ─a─▶ middle ─b─▶ leaf, with an override at each level. */
  function nested(
    outer: AttributeOverrideMap | undefined,
    inner: AttributeOverrideMap | undefined
  ): ResolvedGraph {
    const leaf: ResolvedGraph = {
      id: 'leaf',
      uid: 'leaf',
      name: 'leaf',
      label: 'Leaf',
      nodes: [BATTERY],
      children: [],
    };

    const middle: ResolvedGraph = {
      id: 'middle',
      uid: 'middle',
      name: 'middle',
      label: 'Middle',
      nodes: [],
      children: [{ alias: 'b', attributeOverrides: inner, graph: leaf }],
    };

    return resolvedFrom([], {
      children: [{ alias: 'a', attributeOverrides: outer, graph: middle }],
    });
  }

  it('addresses a grandchild node through the alias chain below the import', () => {
    const nodes = flattenGraph(
      nested(
        { [buildInstanceId(['b'], 'battery')]: { voltage: '48' } },
        undefined
      )
    );

    expect(nodes[0].instancePath).toEqual(['a', 'b']);
    expect(
      nodes[0].attributes.find((attribute) => attribute.name === 'voltage')
        ?.value
    ).toBe('48');
  });

  it('lets the outermost import win when both name the same attribute', () => {
    // The child said 24 for every context; the root said 48 for *this* one.
    // The more contextual instruction is the one that should land.
    const nodes = flattenGraph(
      nested(
        { [buildInstanceId(['b'], 'battery')]: { voltage: '48' } },
        { battery: { voltage: '24' } }
      )
    );

    expect(
      nodes[0].attributes.find((attribute) => attribute.name === 'voltage')
        ?.value
    ).toBe('48');
  });

  it('applies an inner override the outer one says nothing about', () => {
    const nodes = flattenGraph(
      nested(undefined, { battery: { voltage: '24' } })
    );

    expect(
      nodes[0].attributes.find((attribute) => attribute.name === 'voltage')
        ?.value
    ).toBe('24');
  });
});

describe('attribute overrides reach auto-connect', () => {
  /**
   * A charger that only accepts 24 V, next to two banks of the same graph.
   *
   * This is the whole reason overrides are applied during flatten: if they
   * landed any later, the filter would be evaluated against the stored 12 V and
   * the picture would show 24 on a node that is wired as though it were 12.
   */
  function withCharger(overrides: AttributeOverrideMap | undefined) {
    const bank: ResolvedGraph = {
      id: 'bank',
      uid: 'bank',
      name: 'bank',
      label: 'Bank',
      nodes: [BATTERY],
      children: [],
    };

    const charger = makeNode({
      id: 'charger',
      name: 'charger',
      label: 'Charger',
      ports: [
        port({
          name: 'dc_in',
          direction: 'input',
          relationship: 'many',
          attributes: [
            {
              name: 'voltage',
              value: '24',
              kind: 'power',
              filter: {
                logicalOperator: 'AND',
                conditions: [
                  { attribute: 'voltage', value: '24', operator: 'eq' },
                ],
              },
            },
          ],
        }),
      ],
    });

    return resolvedFrom([charger], {
      children: [
        { alias: 'port_bank', graph: bank },
        {
          alias: 'starboard_bank',
          attributeOverrides: overrides,
          graph: bank,
        },
      ],
    });
  }

  it('connects only the overridden instance to a 24 V-only input', () => {
    const view = buildGraphView(withCharger({ battery: { voltage: '24' } }), {
      portKinds: SAMPLE_PORT_KINDS,
      layout: false,
    });

    const incoming = view.edges.filter(
      (edge) => edge.targetInstanceId === 'charger'
    );

    expect(incoming).toHaveLength(1);
    expect(incoming[0].sourceInstanceId).toBe(
      buildInstanceId(['starboard_bank'], 'battery')
    );
  });

  it('connects neither when nothing is overridden', () => {
    const view = buildGraphView(withCharger(undefined), {
      portKinds: SAMPLE_PORT_KINDS,
      layout: false,
    });

    expect(
      view.edges.filter((edge) => edge.targetInstanceId === 'charger')
    ).toEqual([]);
  });

  it('carries stale-override warnings through buildGraphView', () => {
    const view = buildGraphView(withCharger({ ghost: { voltage: '24' } }), {
      portKinds: SAMPLE_PORT_KINDS,
      layout: false,
    });

    expect(
      view.diagnostics.some(
        (entry) => entry.code === 'stale-attribute-override'
      )
    ).toBe(true);
  });
});
