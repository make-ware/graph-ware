import { describe, it, expect } from 'vitest';
import {
  applyOverrides,
  buildGraphView,
  buildInstanceId,
  connectNodes,
  flattenGraph,
  type FlatEdge,
} from '../../index';
import {
  SAMPLES,
  SAMPLE_PORT_KINDS,
  makeOverride,
  sampleTree,
} from '../fixtures/graph-fixtures';

const idOf = (graph: 'BatterySystem' | 'EngineSystem', name: string) =>
  SAMPLES[graph].elements.find((element) => element.name === name)!.id;

const PORT_FUSE = buildInstanceId(
  ['port_bank'],
  idOf('BatterySystem', 'house_fuse')
);
const STARBOARD_FUSE = buildInstanceId(
  ['starboard_bank'],
  idOf('BatterySystem', 'house_fuse')
);
const PORT_BATTERY_1 = buildInstanceId(
  ['port_bank'],
  idOf('BatterySystem', 'house_battery_1')
);
const CERBO = buildInstanceId(
  ['control'],
  idOf('EngineSystem', 'victron_cerbo')
);

const nodes = flattenGraph(sampleTree());
const derived = connectNodes(nodes, SAMPLE_PORT_KINDS);

const into = (edges: readonly FlatEdge[], instanceId: string) =>
  edges.filter((edge) => edge.targetInstanceId === instanceId);

describe('applyOverrides — suppress', () => {
  const suppressFuseToCerbo = makeOverride({
    mode: 'suppress',
    sourcePath: PORT_FUSE,
    sourcePort: 'supply',
    targetPath: CERBO,
    targetPort: 'supply',
  });

  it('removes exactly one edge', () => {
    const result = applyOverrides(nodes, derived, [suppressFuseToCerbo]);

    expect(result.edges).toHaveLength(derived.length - 1);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not hand the freed input to the runner-up', () => {
    // The Cerbo's `supply` is `one` and was claimed by port_bank's fuse.
    // Suppressing that edge leaves the input empty; matching is single-pass and
    // starboard's fuse does not inherit the slot.
    const result = applyOverrides(nodes, derived, [suppressFuseToCerbo]);

    expect(into(result.edges, CERBO)).toHaveLength(0);
    expect(
      result.edges.some((edge) => edge.sourceInstanceId === STARBOARD_FUSE)
    ).toBe(true); // it still wires elsewhere — just not into the freed input
    expect(
      result.edges.some(
        (edge) =>
          edge.sourceInstanceId === STARBOARD_FUSE &&
          edge.targetInstanceId === CERBO
      )
    ).toBe(false);
  });

  it('resolves the port names by direction', () => {
    // `house_fuse` has `supply` as an output *and* an input. The source
    // endpoint must bind the output and the target endpoint the input.
    const result = applyOverrides(nodes, derived, [
      makeOverride({
        mode: 'suppress',
        sourcePath: PORT_FUSE,
        sourcePort: 'supply',
        targetPath: STARBOARD_FUSE,
        targetPort: 'supply',
      }),
    ]);

    expect(result.diagnostics).toHaveLength(0);
    expect(
      result.edges.some(
        (edge) =>
          edge.sourceInstanceId === PORT_FUSE &&
          edge.targetInstanceId === STARBOARD_FUSE
      )
    ).toBe(false);
  });
});

describe('applyOverrides — pin', () => {
  it('adds an edge regardless of kind, filter or budget', () => {
    // HDMI out to a power input: nothing about this would connect on its own,
    // and the Cerbo's `supply` input is already claimed.
    const result = applyOverrides(nodes, derived, [
      makeOverride({
        mode: 'pin',
        sourcePath: CERBO,
        sourcePort: 'hdmi',
        targetPath: PORT_FUSE,
        targetPort: 'supply',
      }),
    ]);

    const pinned = result.edges.filter((edge) => edge.origin === 'pinned');
    expect(pinned).toHaveLength(1);
    expect(pinned[0].kind).toBe('video/hdmi');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not duplicate an edge that was already derived', () => {
    const result = applyOverrides(nodes, derived, [
      makeOverride({
        mode: 'pin',
        sourcePath: PORT_BATTERY_1,
        sourcePort: 'supply',
        targetPath: PORT_FUSE,
        targetPort: 'supply',
      }),
    ]);

    expect(result.edges).toHaveLength(derived.length);
  });
});

describe('applyOverrides — stale records', () => {
  const stale = (overrides: Parameters<typeof makeOverride>[0]) =>
    applyOverrides(nodes, derived, [makeOverride(overrides)]).diagnostics;

  it('reports a source path that names no node', () => {
    const diagnostics = stale({
      mode: 'suppress',
      sourcePath: 'ghost_bank/nobody',
      sourcePort: 'supply',
      targetPath: CERBO,
      targetPort: 'supply',
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('stale-override');
    expect(diagnostics[0].level).toBe('warning');
  });

  it('reports a target path that names no node', () => {
    expect(
      stale({
        mode: 'pin',
        sourcePath: PORT_FUSE,
        sourcePort: 'supply',
        targetPath: 'ghost_bank/nobody',
        targetPort: 'supply',
      })[0].code
    ).toBe('stale-override');
  });

  it('reports a port name that no longer exists', () => {
    expect(
      stale({
        mode: 'pin',
        sourcePath: PORT_FUSE,
        sourcePort: 'shore_power',
        targetPath: CERBO,
        targetPort: 'supply',
      })[0].code
    ).toBe('stale-override');
  });

  it('reports a suppress that matched no derived edge', () => {
    // Valid endpoints, valid ports — but these two were never connected.
    expect(
      stale({
        mode: 'suppress',
        sourcePath: STARBOARD_FUSE,
        sourcePort: 'supply',
        targetPath: CERBO,
        targetPort: 'supply',
      })[0].code
    ).toBe('stale-override');
  });

  it('does not crash, and leaves the wiring alone', () => {
    const result = applyOverrides(nodes, derived, [
      makeOverride({
        mode: 'suppress',
        sourcePath: 'ghost_bank/nobody',
        sourcePort: 'supply',
        targetPath: 'ghost_bank/nobody_else',
        targetPort: 'supply',
      }),
    ]);

    expect(result.edges).toHaveLength(derived.length);
  });

  it('stays quiet about out-of-frame endpoints in a focused view', () => {
    const view = buildGraphView(sampleTree(), {
      portKinds: SAMPLE_PORT_KINDS,
      focus: ['port_bank'],
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

    expect(
      view.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'stale-override'
      )
    ).toHaveLength(0);
  });
});

describe('overrides through the whole pipeline', () => {
  it('applies suppressions before pins, whatever order they arrive in', () => {
    const overrides = [
      makeOverride({
        mode: 'pin',
        sourcePath: STARBOARD_FUSE,
        sourcePort: 'supply',
        targetPath: CERBO,
        targetPort: 'supply',
      }),
      makeOverride({
        mode: 'suppress',
        sourcePath: PORT_FUSE,
        sourcePort: 'supply',
        targetPath: CERBO,
        targetPort: 'supply',
      }),
    ];

    const forwards = buildGraphView(sampleTree(), {
      portKinds: SAMPLE_PORT_KINDS,
      overrides,
    });
    const backwards = buildGraphView(sampleTree(), {
      portKinds: SAMPLE_PORT_KINDS,
      overrides: [...overrides].reverse(),
    });

    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));

    const incoming = into(forwards.edges, CERBO);
    expect(incoming).toHaveLength(1);
    expect(incoming[0].origin).toBe('pinned');
    expect(incoming[0].sourceInstanceId).toBe(STARBOARD_FUSE);
  });
});
