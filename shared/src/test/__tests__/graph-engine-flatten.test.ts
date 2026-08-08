import { describe, it, expect } from 'vitest';
import { buildInstanceId, flattenGraph, focusNodes } from '@project/shared';
import {
  SAMPLES,
  makeNode,
  resolvedFrom,
  sampleTree,
  shuffleTree,
  toResolvedGraph,
} from './fixtures/graph-fixtures';

const FUSE_ID = SAMPLES.BatterySystem.elements.find(
  (element) => element.name === 'house_fuse'
)!.id;

describe('flattenGraph', () => {
  it('emits every node in the tree once per import instance', () => {
    const nodes = flattenGraph(sampleTree());

    // Three battery nodes twice over, plus the one Cerbo GX. The root graph
    // itself has no nodes of its own.
    expect(nodes).toHaveLength(7);
    expect(new Set(nodes.map((node) => node.instanceId)).size).toBe(7);
  });

  it('gives the same node two instance ids under two aliases', () => {
    const nodes = flattenGraph(sampleTree());
    const fuses = nodes.filter((node) => node.nodeId === FUSE_ID);

    expect(fuses).toHaveLength(2);
    expect(fuses.map((node) => node.instanceId)).toEqual([
      buildInstanceId(['port_bank'], FUSE_ID),
      buildInstanceId(['starboard_bank'], FUSE_ID),
    ]);
    // Same record, same graph — only the instance path tells them apart.
    expect(fuses[0].graphId).toBe(fuses[1].graphId);
  });

  it('numbers colour groups per instance, not per graph', () => {
    const nodes = flattenGraph(sampleTree());
    const indexFor = (alias: string) =>
      nodes.find((node) => node.instancePath[0] === alias)!.graphColorIndex;

    // port_bank and starboard_bank are one BatterySystem but two visual groups.
    expect(indexFor('port_bank')).toBe(1);
    expect(indexFor('starboard_bank')).toBe(2);
    expect(indexFor('control')).toBe(3);
  });

  it('builds breadcrumbs from the import label, falling back to the graph label', () => {
    const nodes = flattenGraph(sampleTree());
    const fuse = nodes.find(
      (node) => node.instancePath[0] === 'port_bank' && node.nodeId === FUSE_ID
    )!;

    expect(fuse.breadcrumb).toEqual(['Test Element Data', 'Port Battery Bank']);

    const unlabelled = flattenGraph(
      toResolvedGraph(SAMPLES.testDataElement, [
        { alias: 'port_bank', graph: toResolvedGraph(SAMPLES.BatterySystem) },
      ])
    );
    expect(unlabelled[0].breadcrumb).toEqual([
      'Test Element Data',
      'Battery System',
    ]);
  });

  it('orders a graph’s own nodes by name', () => {
    const nodes = flattenGraph(sampleTree()).filter(
      (node) => node.instancePath[0] === 'port_bank'
    );

    expect(nodes.map((node) => node.name)).toEqual([
      'house_battery_1',
      'house_battery_2',
      'house_fuse',
    ]);
  });

  it('is unaffected by the order the nodes arrived in', () => {
    const ordered = flattenGraph(sampleTree());
    const shuffled = flattenGraph(shuffleTree(sampleTree(), 7));

    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(ordered));
  });

  it('does not mutate the tree it was given', () => {
    const tree = sampleTree();
    const before = tree.children[0].graph.nodes.map((node) => node.name);

    flattenGraph(tree);

    expect(tree.children[0].graph.nodes.map((node) => node.name)).toEqual(
      before
    );
  });

  it('keeps a stored position only on the root graph', () => {
    const positioned = makeNode({
      id: 'placed',
      name: 'placed',
      position: { x: 40, y: 80 },
    });

    const atRoot = flattenGraph(resolvedFrom([positioned]));
    expect(atRoot[0].position).toEqual({ x: 40, y: 80 });

    // The position lives on the record, so both instances of an imported graph
    // would claim the same coordinates and stack exactly on top of each other.
    const imported = flattenGraph(
      resolvedFrom([], {
        children: [
          { alias: 'a', graph: resolvedFrom([positioned]) },
          { alias: 'b', graph: resolvedFrom([positioned]) },
        ],
      })
    );
    expect(imported.map((node) => node.position)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('focusNodes', () => {
  it('keeps everything when no focus is given', () => {
    const nodes = flattenGraph(sampleTree());
    expect(focusNodes(nodes, [])).toHaveLength(nodes.length);
  });

  it('keeps one import instance without its twin', () => {
    const nodes = flattenGraph(sampleTree());
    const focused = focusNodes(nodes, ['port_bank']);

    expect(focused).toHaveLength(3);
    expect(focused.every((node) => node.instancePath[0] === 'port_bank')).toBe(
      true
    );
  });

  it('matches path segments, not string prefixes', () => {
    const nodes = flattenGraph(
      resolvedFrom([], {
        children: [
          { alias: 'port', graph: resolvedFrom([makeNode({ name: 'a' })]) },
          {
            alias: 'port_bank',
            graph: resolvedFrom([makeNode({ name: 'b' })]),
          },
        ],
      })
    );

    // A naive `startsWith` on the joined path would drag `port_bank` in too.
    expect(focusNodes(nodes, ['port'])).toHaveLength(1);
    expect(focusNodes(nodes, ['port'])[0].name).toBe('a');
  });
});
