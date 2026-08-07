import { describe, it, expect } from 'vitest';
import {
  buildGraphView,
  buildInstanceId,
  connectNodes,
  flattenGraph,
  validateGraph,
  type Port,
  type ResolvedGraph,
} from '@project/shared';
import {
  SAMPLES,
  SAMPLE_PORT_KINDS,
  makeNode,
  makeOverride,
  resolvedFrom,
  sampleTree,
} from './fixtures/graph-fixtures';

const CERBO = buildInstanceId(['control'], SAMPLES.EngineSystem.elements[0].id);
const PORT_FUSE = buildInstanceId(
  ['port_bank'],
  SAMPLES.BatterySystem.elements.find((el) => el.name === 'house_fuse')!.id
);
const STARBOARD_FUSE = buildInstanceId(
  ['starboard_bank'],
  SAMPLES.BatterySystem.elements.find((el) => el.name === 'house_fuse')!.id
);

const codes = (view: { diagnostics: { code: string }[] }) =>
  view.diagnostics.map((diagnostic) => diagnostic.code);

/** The sample tree with every battery and fuse pushed outside 10–15 volts. */
function atVoltage(volts: string): ResolvedGraph {
  const tree = sampleTree();
  return {
    ...tree,
    children: tree.children.map((child) => ({
      ...child,
      graph: {
        ...child.graph,
        nodes: child.graph.nodes.map((node) => ({
          ...node,
          attributes: node.attributes?.map((attribute) =>
            attribute.name === 'voltage'
              ? { ...attribute, value: volts }
              : attribute
          ),
        })),
      },
    })),
  };
}

describe('required inputs', () => {
  it('stays quiet when the Cerbo GX has a supply in range', () => {
    const view = buildGraphView(sampleTree(), {
      portKinds: SAMPLE_PORT_KINDS,
    });

    expect(codes(view)).not.toContain('required-input-unconnected');
  });

  it('errors when every candidate source is out of the voltage window', () => {
    const view = buildGraphView(atVoltage('24'), {
      portKinds: SAMPLE_PORT_KINDS,
    });

    const error = view.diagnostics.find(
      (diagnostic) => diagnostic.code === 'required-input-unconnected'
    )!;
    expect(error.level).toBe('error');
    expect(error.instanceId).toBe(CERBO);
    expect(error.path).toEqual(['Test Element Data', 'Control System']);
  });

  it('clears once one in-range source appears', () => {
    // Same tree, batteries back at 12 volts: the diagnostic is gone.
    expect(
      codes(buildGraphView(atVoltage('12'), { portKinds: SAMPLE_PORT_KINDS }))
    ).not.toContain('required-input-unconnected');
  });

  it('counts a pinned edge as satisfying the requirement', () => {
    const view = buildGraphView(atVoltage('24'), {
      portKinds: SAMPLE_PORT_KINDS,
      overrides: [
        makeOverride({
          mode: 'pin',
          sourcePath: PORT_FUSE,
          sourcePort: 'supply',
          targetPath: CERBO,
          targetPort: 'supply',
        }),
      ],
    });

    expect(codes(view)).not.toContain('required-input-unconnected');
  });

  it('reappears when the only edge feeding it is suppressed', () => {
    const view = buildGraphView(sampleTree(), {
      portKinds: SAMPLE_PORT_KINDS,
      overrides: [
        makeOverride({
          mode: 'suppress',
          sourcePath: PORT_FUSE,
          sourcePort: 'supply',
          targetPath: CERBO,
          targetPort: 'supply',
        }),
      ],
    });

    expect(codes(view)).toContain('required-input-unconnected');
    // And the starboard fuse did not quietly take the freed slot.
    expect(
      view.edges.some(
        (edge) =>
          edge.sourceInstanceId === STARBOARD_FUSE &&
          edge.targetInstanceId === CERBO
      )
    ).toBe(false);
  });

  it('ignores an unconnected input that is not required', () => {
    const optional: Port = { name: 'aux', direction: 'input', kind: 'power' };
    const view = buildGraphView(
      resolvedFrom([makeNode({ name: 'thing', ports: [optional] })]),
      { portKinds: SAMPLE_PORT_KINDS }
    );

    expect(codes(view)).not.toContain('required-input-unconnected');
  });
});

describe('unknown port kinds', () => {
  const exotic = resolvedFrom([
    makeNode({
      name: 'thing',
      ports: [
        { name: 'out', direction: 'output', kind: 'plasma' },
        { name: 'aux', direction: 'output', kind: 'plasma' },
      ],
    }),
  ]);

  it('reports a kind with no registry row, once per node', () => {
    const nodes = flattenGraph(exotic);
    const diagnostics = validateGraph(
      nodes,
      connectNodes(nodes, SAMPLE_PORT_KINDS),
      SAMPLE_PORT_KINDS
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('unknown-port-kind');
    expect(diagnostics[0].level).toBe('info');
    expect(diagnostics[0].message).toContain('plasma');
  });

  it('says nothing when no registry was loaded at all', () => {
    // A caller that could not read `PortKinds` should get silence, not a
    // diagnostic against every port in the graph.
    const nodes = flattenGraph(exotic);
    expect(validateGraph(nodes, connectNodes(nodes))).toHaveLength(0);
  });
});

describe('diagnostic ordering', () => {
  it('puts resolver diagnostics first, then overrides, then validation', () => {
    const view = buildGraphView(atVoltage('24'), {
      portKinds: SAMPLE_PORT_KINDS,
      diagnostics: [
        {
          level: 'info',
          code: 'import-disabled',
          message: 'from the resolver',
        },
      ],
      overrides: [
        makeOverride({
          mode: 'suppress',
          sourcePath: 'ghost/nobody',
          sourcePort: 'supply',
          targetPath: CERBO,
          targetPort: 'supply',
        }),
      ],
    });

    expect(codes(view)).toEqual([
      'import-disabled',
      'stale-override',
      'required-input-unconnected',
    ]);
  });
});
