import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GraphMutator,
  GraphNodeMutator,
  GraphImportMutator,
  GraphEdgeOverrideMutator,
} from '@project/shared/mutators';
import type { TypedPocketBase } from '@/types';
import {
  createMockPocketBase,
  createMockUser,
  MockAuthStore,
  notFoundError,
} from './fixtures/pocketbase';

function setup(signedIn = true) {
  const authStore = new MockAuthStore();
  if (signedIn) {
    authStore.setAuth('token', createMockUser({ id: 'user_1' }));
  }

  const { mockPb, mockCollection } = createMockPocketBase(authStore);
  return {
    pb: mockPb as unknown as TypedPocketBase,
    collection: mockCollection,
  };
}

describe('GraphMutator', () => {
  let context: ReturnType<typeof setup>;

  beforeEach(() => {
    context = setup();
    vi.clearAllMocks();
  });

  it('injects the signed-in user as owner on create', async () => {
    context.collection.create.mockResolvedValue({ id: 'graph_1' });

    const mutator = new GraphMutator(context.pb);
    await mutator.create({
      workspace: 'workspace_1',
      uid: 'BatterySystem',
      name: 'battery_system',
      label: 'Battery System',
      visibility: 'private',
    });

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'user_1',
        workspace: 'workspace_1',
        uid: 'BatterySystem',
      })
    );
  });

  it('falls back to the personal workspace when none is given', async () => {
    context.collection.create.mockResolvedValue({ id: 'graph_1' });
    context.collection.getFirstListItem.mockResolvedValue({
      id: 'workspace_personal',
      personal: true,
    });

    const mutator = new GraphMutator(context.pb);
    await mutator.create({
      uid: 'BatterySystem',
      name: 'battery_system',
      label: 'Battery System',
      visibility: 'private',
    });

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: 'workspace_personal' })
    );
  });

  it('refuses to create a graph with nowhere to put it', async () => {
    // No personal workspace and no fallback — a broken account rather than a
    // state to paper over, so the write never leaves the client.
    context.collection.getFirstListItem.mockRejectedValue(notFoundError());

    const mutator = new GraphMutator(context.pb);

    await expect(
      mutator.create({
        uid: 'BatterySystem',
        name: 'battery_system',
        label: 'Battery System',
        visibility: 'private',
      })
    ).rejects.toThrow(/not a member of any workspace/i);
    expect(context.collection.create).not.toHaveBeenCalled();
  });

  it('refuses to create a graph while signed out', async () => {
    const signedOut = setup(false);
    const mutator = new GraphMutator(signedOut.pb);

    await expect(
      mutator.create({
        uid: 'BatterySystem',
        name: 'battery_system',
        label: 'Battery System',
        visibility: 'private',
      })
    ).rejects.toThrow(/signed out/i);
    expect(signedOut.collection.create).not.toHaveBeenCalled();
  });

  it('rejects a uid with characters the schema forbids', async () => {
    const mutator = new GraphMutator(context.pb);

    await expect(
      mutator.create({
        uid: 'battery system',
        name: 'battery_system',
        label: 'Battery System',
        visibility: 'private',
      })
    ).rejects.toThrow();
    expect(context.collection.create).not.toHaveBeenCalled();
  });

  it('rejects a machine name that is not snake case', async () => {
    const mutator = new GraphMutator(context.pb);

    await expect(
      mutator.create({
        uid: 'BatterySystem',
        name: 'Battery System',
        label: 'Battery System',
        visibility: 'private',
      })
    ).rejects.toThrow();
  });

  it('sets no owner filter — read rules also admit public graphs', async () => {
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 0 });

    const mutator = new GraphMutator(context.pb);
    await mutator.getList();

    const [, , options] = context.collection.getList.mock.calls[0];
    expect(options.filter).toBeUndefined();
    expect(options.sort).toBe('namespace,label');
  });

  it('scopes listMine to the signed-in user explicitly', async () => {
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 0 });

    await new GraphMutator(context.pb).listMine();

    const [, , options] = context.collection.getList.mock.calls[0];
    expect(options.filter).toBe('owner = "user_1"');
  });

  it('counts importers via the child relation', async () => {
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 3 });

    const count = await new GraphMutator(context.pb).countImporters('graph_1');

    expect(count).toBe(3);
    expect(context.collection.getList).toHaveBeenCalledWith(1, 1, {
      filter: 'child = "graph_1"',
    });
  });
});

describe('GraphNodeMutator', () => {
  let context: ReturnType<typeof setup>;

  beforeEach(() => {
    context = setup();
    vi.clearAllMocks();
  });

  it('sorts by name, matching the deterministic ordering the engine uses', async () => {
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 0 });

    await new GraphNodeMutator(context.pb).listForGraph('graph_1');

    const [, , options] = context.collection.getList.mock.calls[0];
    expect(options.sort).toBe('name');
    expect(options.filter).toBe('graph = "graph_1"');
  });

  it('batches several graphs into one filter', async () => {
    context.collection.getFullList.mockResolvedValue([]);

    await new GraphNodeMutator(context.pb).listForGraphs(['a', 'b', 'c']);

    expect(context.collection.getFullList).toHaveBeenCalledWith({
      filter: 'graph = "a" || graph = "b" || graph = "c"',
      sort: 'name',
    });
  });

  it('makes no request for an empty batch', async () => {
    const nodes = await new GraphNodeMutator(context.pb).listForGraphs([]);

    expect(nodes).toEqual([]);
    expect(context.collection.getFullList).not.toHaveBeenCalled();
  });

  it('validates ports before writing', async () => {
    const mutator = new GraphNodeMutator(context.pb);

    await expect(
      mutator.create({
        graph: 'graph_1',
        name: 'house_fuse',
        label: 'Fuse',
        ports: [
          // @ts-expect-error deliberately invalid direction
          { name: 'supply', direction: 'sideways', kind: 'power' },
        ],
      })
    ).rejects.toThrow();
    expect(context.collection.create).not.toHaveBeenCalled();
  });

  it('accepts a node carrying attributes and ports from the sample data', async () => {
    context.collection.create.mockResolvedValue({ id: 'node_1' });

    await new GraphNodeMutator(context.pb).create({
      graph: 'graph_1',
      name: 'house_battery_1',
      label: 'House Battery 1',
      attributes: [
        { name: 'voltage', value: '12', unit: 'volts', kind: 'power' },
      ],
      ports: [
        {
          name: 'supply',
          direction: 'output',
          relationship: 'one',
          kind: 'power',
        },
      ],
    });

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({ graph: 'graph_1', name: 'house_battery_1' })
    );
  });
});

describe('GraphImportMutator', () => {
  let context: ReturnType<typeof setup>;

  beforeEach(() => {
    context = setup();
    vi.clearAllMocks();
  });

  it('expands the child and orders by the order field', async () => {
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 0 });

    await new GraphImportMutator(context.pb).listForParent('root');

    const [, , options] = context.collection.getList.mock.calls[0];
    expect(options.expand).toBe('child');
    expect(options.sort).toBe('order,alias');
  });

  it('refuses to add an import that would create a cycle', async () => {
    context.collection.getFullList.mockResolvedValue([
      { parent: 'root', child: 'battery' },
    ]);
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 0 });

    await expect(
      new GraphImportMutator(context.pb).addImport('battery', 'root')
    ).rejects.toThrow(/loop/i);
    expect(context.collection.create).not.toHaveBeenCalled();
  });

  it('refuses a self-import', async () => {
    context.collection.getFullList.mockResolvedValue([]);
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 0 });

    await expect(
      new GraphImportMutator(context.pb).addImport('root', 'root')
    ).rejects.toThrow(/itself/i);
  });

  it('allocates a distinct alias when the child is already imported', async () => {
    context.collection.getFullList.mockResolvedValue([
      { parent: 'root', child: 'battery' },
    ]);
    context.collection.getList.mockResolvedValue({
      items: [{ alias: 'battery_system', child: 'battery' }],
      totalItems: 1,
    });
    context.collection.getOne.mockResolvedValue({
      name: 'battery_system',
      uid: 'BatterySystem',
    });
    context.collection.create.mockResolvedValue({ id: 'import_2' });

    await new GraphImportMutator(context.pb).addImport('root', 'battery');

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: 'root',
        child: 'battery',
        alias: 'battery_system_2',
        order: 1,
        enabled: true,
      })
    );
  });

  it('honours an explicit alias when it is free', async () => {
    context.collection.getFullList.mockResolvedValue([]);
    context.collection.getList.mockResolvedValue({ items: [], totalItems: 0 });
    context.collection.create.mockResolvedValue({ id: 'import_1' });

    await new GraphImportMutator(context.pb).addImport('root', 'battery', {
      alias: 'port_bank',
      label: 'Port Battery Bank',
    });

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: 'port_bank',
        label: 'Port Battery Bank',
      })
    );
    // The child's name is only fetched when no alias was supplied.
    expect(context.collection.getOne).not.toHaveBeenCalled();
  });

  it('reduces edges to parent/child pairs for the cycle check', async () => {
    context.collection.getFullList.mockResolvedValue([
      { id: 'i1', parent: 'root', child: 'battery', alias: 'port_bank' },
    ]);

    const edges = await new GraphImportMutator(context.pb).listAllEdges();

    expect(edges).toEqual([{ parent: 'root', child: 'battery' }]);
    expect(context.collection.getFullList).toHaveBeenCalledWith({
      fields: 'parent,child',
    });
  });
});

describe('GraphEdgeOverrideMutator', () => {
  it('loads only the root graph overrides — they do not inherit', async () => {
    const context = setup();
    context.collection.getFullList.mockResolvedValue([]);

    await new GraphEdgeOverrideMutator(context.pb).listForGraph('root');

    expect(context.collection.getFullList).toHaveBeenCalledWith({
      filter: 'graph = "root"',
      sort: 'sourcePath,sourcePort',
    });
  });

  it('validates the override mode', async () => {
    const context = setup();
    const mutator = new GraphEdgeOverrideMutator(context.pb);

    await expect(
      mutator.create({
        graph: 'root',
        // @ts-expect-error deliberately invalid mode
        mode: 'reroute',
        sourcePath: 'port_bank/node_a',
        sourcePort: 'supply',
        targetPath: 'control/node_b',
        targetPort: 'supply',
      })
    ).rejects.toThrow();
  });

  it('accepts instance paths as endpoints', async () => {
    const context = setup();
    context.collection.create.mockResolvedValue({ id: 'override_1' });

    await new GraphEdgeOverrideMutator(context.pb).create({
      graph: 'root',
      mode: 'suppress',
      sourcePath: 'starboard_bank/house_battery_1',
      sourcePort: 'supply',
      targetPath: 'control/victron_cerbo',
      targetPort: 'supply',
      reason: 'Only the port bank feeds the Cerbo',
    });

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: 'starboard_bank/house_battery_1',
        mode: 'suppress',
      })
    );
  });
});
