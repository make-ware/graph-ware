// Graph fixtures for the engine and resolver tests.
//
// `example/data/*.json` is the *original Node-Ware file format* — `elements[]`
// where the database has `GraphNodes`, and `childGraphs: ["BatterySystem", …]`,
// a UID array that cannot express importing the same child twice. Since
// importing one child twice is the case almost every test turns on, the
// `childGraphs` field is ignored here and the import tree is spelled out in
// `SAMPLE_IMPORTS`, mirroring the `IMPORTS` map in `scripts/seed-graphs.mjs`.
// Change one, change the other.

import batterySystem from '../../../../example/data/BatterySystem.json';
import engineSystem from '../../../../example/data/EngineSystem.json';
import testDataElement from '../../../../example/data/testDataElement.json';
import type {
  Attribute,
  Graph,
  GraphEdgeOverride,
  GraphImport,
  GraphNode,
  GraphVersion,
  Port,
  PortKindRegistry,
  ResolvedChild,
  ResolvedGraph,
} from '../../index';
import { serializeGraph } from '../../index';
import type { ResolvedGraphData } from '../../lib/graph/resolver';

interface SampleElement {
  id: string;
  name: string;
  label: string;
  attributes?: unknown;
  ports?: unknown;
}

interface SampleGraph {
  id: string;
  uid: string;
  name: string;
  label: string;
  namespace?: string;
  elements: SampleElement[];
}

export const SAMPLES: Record<string, SampleGraph> = {
  testDataElement: testDataElement as SampleGraph,
  BatterySystem: batterySystem as SampleGraph,
  EngineSystem: engineSystem as SampleGraph,
};

/** The seeded tree: `BatterySystem` twice, `EngineSystem` once. */
export const SAMPLE_IMPORTS = [
  { child: 'BatterySystem', alias: 'port_bank', label: 'Port Battery Bank' },
  {
    child: 'BatterySystem',
    alias: 'starboard_bank',
    label: 'Starboard Battery Bank',
  },
  { child: 'EngineSystem', alias: 'control', label: 'Control System' },
] as const;

// The sample data only uses these four; none of them declares `compatibleWith`.
export const SAMPLE_PORT_KINDS: PortKindRegistry = {
  power: { key: 'power' },
  'data/canbus': { key: 'data/canbus' },
  'data/vbus': { key: 'data/vbus' },
  'video/hdmi': { key: 'video/hdmi' },
};

const RECORD_STAMP = {
  created: '2026-01-01 00:00:00.000Z',
  updated: '2026-01-01 00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Sample data → records
// ---------------------------------------------------------------------------

export function toGraph(sample: SampleGraph): Graph {
  return {
    ...RECORD_STAMP,
    id: sample.id,
    owner: 'demo_user_id',
    uid: sample.uid,
    name: sample.name,
    label: sample.label,
    namespace: sample.namespace,
    visibility: 'private',
    tags: ['sample'],
  } as unknown as Graph;
}

export function toGraphNodes(sample: SampleGraph): GraphNode[] {
  return sample.elements.map(
    (element) =>
      ({
        ...RECORD_STAMP,
        id: element.id,
        graph: sample.id,
        name: element.name,
        label: element.label,
        attributes: (element.attributes ?? []) as Attribute[],
        ports: (element.ports ?? []) as Port[],
      }) as unknown as GraphNode
  );
}

export function toResolvedGraph(
  sample: SampleGraph,
  children: ResolvedChild[] = []
): ResolvedGraph {
  return {
    id: sample.id,
    uid: sample.uid,
    name: sample.name,
    label: sample.label,
    namespace: sample.namespace,
    nodes: toGraphNodes(sample),
    children,
  };
}

/** `testDataElement` with its three import instances resolved. */
export function sampleTree(): ResolvedGraph {
  return toResolvedGraph(
    SAMPLES.testDataElement,
    SAMPLE_IMPORTS.map((record) => ({
      alias: record.alias,
      label: record.label,
      graph: toResolvedGraph(SAMPLES[record.child]),
    }))
  );
}

/** The same tree as loose records, for `assembleResolvedGraph`. */
export function sampleBundle(): ResolvedGraphData {
  const graphs = new Map<string, Graph>();
  const nodesByGraph = new Map<string, GraphNode[]>();
  for (const sample of Object.values(SAMPLES)) {
    graphs.set(sample.id, toGraph(sample));
    nodesByGraph.set(sample.id, toGraphNodes(sample));
  }

  const imports = SAMPLE_IMPORTS.map((record, index) =>
    makeImport({
      id: `import_${record.alias}`,
      parent: SAMPLES.testDataElement.id,
      child: SAMPLES[record.child].id,
      alias: record.alias,
      label: record.label,
      order: index,
    })
  );

  return {
    graphs,
    nodesByGraph,
    importsByParent: new Map([[SAMPLES.testDataElement.id, imports]]),
    pins: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Synthetic records, for cases the sample data does not contain
// ---------------------------------------------------------------------------

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${++sequence}`;

export function makeGraph(overrides: Partial<Graph> = {}): Graph {
  const id = overrides.id ?? nextId('graph');
  return {
    ...RECORD_STAMP,
    id,
    owner: 'demo_user_id',
    uid: id,
    name: id,
    label: id,
    visibility: 'private',
    ...overrides,
  } as unknown as Graph;
}

export function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  const id = overrides.id ?? nextId('node');
  return {
    ...RECORD_STAMP,
    id,
    graph: 'graph_1',
    name: id,
    label: id,
    attributes: [],
    ports: [],
    ...overrides,
  } as unknown as GraphNode;
}

export function makeImport(overrides: Partial<GraphImport> = {}): GraphImport {
  return {
    ...RECORD_STAMP,
    id: nextId('import'),
    parent: 'graph_1',
    child: 'graph_2',
    alias: 'child',
    order: 0,
    enabled: true,
    ...overrides,
  } as unknown as GraphImport;
}

export function makeOverride(
  overrides: Partial<GraphEdgeOverride> = {}
): GraphEdgeOverride {
  return {
    ...RECORD_STAMP,
    id: nextId('override'),
    graph: 'graph_1',
    mode: 'suppress',
    sourcePath: '',
    sourcePort: '',
    targetPath: '',
    targetPort: '',
    ...overrides,
  } as unknown as GraphEdgeOverride;
}

/** A `GraphVersions` record wrapping a snapshot of `graph` as it stands. */
export function makeVersion(
  graph: Graph,
  nodes: readonly GraphNode[],
  imports: readonly GraphImport[] = [],
  overrides: Partial<GraphVersion> = {}
): GraphVersion {
  return {
    ...RECORD_STAMP,
    id: nextId('version'),
    graph: graph.id,
    version: 1,
    snapshot: serializeGraph(graph, nodes, imports),
    createdBy: 'demo_user_id',
    ...overrides,
  } as unknown as GraphVersion;
}

/** A graph with `nodes` and no imports, ready to hand to the engine. */
export function resolvedFrom(
  nodes: GraphNode[],
  overrides: Partial<ResolvedGraph> = {}
): ResolvedGraph {
  return {
    id: 'graph_root',
    uid: 'root',
    name: 'root',
    label: 'Root',
    nodes,
    children: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/**
 * Shuffle reproducibly.
 *
 * A `Math.random` shuffle makes a determinism failure a one-in-N flake that
 * cannot be reproduced; a seeded LCG makes it a permanent, debuggable failure.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed || 1;

  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }

  return result;
}

/**
 * The same tree with every node list shuffled.
 *
 * Child order is left alone on purpose: the resolver sorts imports by
 * `(order, alias)` and the engine trusts that, so child order is canonical
 * input rather than incidental. Node order is what arrives however PocketBase
 * felt like returning it, and is what must not matter.
 */
export function shuffleTree(graph: ResolvedGraph, seed: number): ResolvedGraph {
  return {
    ...graph,
    nodes: seededShuffle(graph.nodes, seed),
    children: graph.children.map((child) => ({
      ...child,
      graph: shuffleTree(child.graph, seed + 1),
    })),
  };
}
