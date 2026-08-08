import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  roleCanAdminister,
  roleCanWrite,
  toSlug,
  WORKSPACE_SLUG_PATTERN,
} from '@project/shared';
import {
  GraphVersionMutator,
  WorkspaceMemberMutator,
  WorkspaceMutator,
} from '@project/shared/mutators';
import type { TypedPocketBase } from '@/types';
import {
  createMockPocketBase,
  createMockUser,
  MockAuthStore,
  notFoundError,
} from './fixtures/pocketbase';
import { makeGraph, makeNode, makeVersion } from './fixtures/graph-fixtures';

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

describe('toSlug', () => {
  it('produces something the schema will accept', () => {
    for (const input of [
      'North Sea Refit',
      '  Trailing spaces  ',
      'Symbols!! & things',
      'ALL CAPS',
      '2026 Project',
    ]) {
      expect(toSlug(input)).toMatch(WORKSPACE_SLUG_PATTERN);
    }
  });

  it('never leaves a dash at either end, even after truncation', () => {
    // 40 characters lands mid-word; trimming the tail must not leave the dash
    // that the pattern forbids.
    const slug = toSlug(`${'a'.repeat(39)} bravo`);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toMatch(WORKSPACE_SLUG_PATTERN);
  });

  it('collapses runs of punctuation into one dash', () => {
    expect(toSlug('one -- two')).toBe('one-two');
  });
});

describe('workspace roles', () => {
  it('lets admins and members write, but not viewers', () => {
    expect(roleCanWrite('admin')).toBe(true);
    expect(roleCanWrite('member')).toBe(true);
    expect(roleCanWrite('viewer')).toBe(false);
    expect(roleCanWrite(undefined)).toBe(false);
  });

  it('lets only admins administer', () => {
    expect(roleCanAdminister('admin')).toBe(true);
    expect(roleCanAdminister('member')).toBe(false);
  });
});

describe('WorkspaceMutator', () => {
  let context: ReturnType<typeof setup>;

  beforeEach(() => {
    context = setup();
    vi.clearAllMocks();
  });

  it('injects the signed-in user as owner on create', async () => {
    context.collection.create.mockResolvedValue({ id: 'workspace_1' });

    await new WorkspaceMutator(context.pb).create({
      name: 'North Sea',
      slug: 'north-sea',
      personal: false,
    });

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'user_1', slug: 'north-sea' })
    );
  });

  it('refuses to create a workspace while signed out', async () => {
    const signedOut = setup(false);

    await expect(
      new WorkspaceMutator(signedOut.pb).create({
        name: 'North Sea',
        slug: 'north-sea',
        personal: false,
      })
    ).rejects.toThrow(/signed out/i);
  });

  it('reports the caller’s role in each workspace', async () => {
    context.collection.getFullList
      // Workspaces
      .mockResolvedValueOnce([
        { id: 'ws_own', owner: 'user_1', name: 'Mine' },
        { id: 'ws_team', owner: 'someone_else', name: 'Team' },
        { id: 'ws_read', owner: 'someone_else', name: 'Read only' },
      ])
      // WorkspaceMembers
      .mockResolvedValueOnce([
        { workspace: 'ws_team', user: 'user_1', role: 'member' },
        { workspace: 'ws_read', user: 'user_1', role: 'viewer' },
      ]);

    const rows = await new WorkspaceMutator(context.pb).listMine();

    // The creator is reported as `owner` even with no roll row of their own —
    // the rules admit `workspace.owner` directly, so a missing row must not
    // downgrade them.
    expect(rows.map((row) => row.role)).toEqual(['owner', 'member', 'viewer']);
  });

  it('returns no workspaces while signed out rather than throwing', async () => {
    const signedOut = setup(false);
    expect(await new WorkspaceMutator(signedOut.pb).listMine()).toEqual([]);
  });

  it('treats a real PocketBase 404 as "no such workspace"', async () => {
    // `getFirstByFilter` is how the whole Phase 5 data layer asks "is there a
    // row matching this?" — `personal()`, `getBySlug()`, `availableSlug()`,
    // `WorkspaceMemberMutator.mine()`. `BaseMutator.isNotFoundError` used to
    // match on the message, and PocketBase's is "The requested resource wasn't
    // found." — no `404`, no `not found` — so every one of them threw instead
    // of returning null.
    context.collection.getFirstListItem.mockRejectedValue(notFoundError());

    expect(await new WorkspaceMutator(context.pb).personal()).toBeNull();
    expect(await new WorkspaceMutator(context.pb).getBySlug('nope')).toBeNull();
  });

  it('appends a suffix when a slug is taken', async () => {
    context.collection.getFirstListItem
      .mockResolvedValueOnce({ id: 'ws_1', slug: 'north-sea' })
      .mockRejectedValueOnce(notFoundError());

    expect(
      await new WorkspaceMutator(context.pb).availableSlug('North Sea')
    ).toBe('north-sea-2');
  });
});

describe('WorkspaceMemberMutator', () => {
  let context: ReturnType<typeof setup>;

  beforeEach(() => {
    context = setup();
    vi.clearAllMocks();
  });

  it('updates the role rather than duplicating an existing member', async () => {
    context.collection.getFirstListItem.mockResolvedValue({
      id: 'member_1',
      workspace: 'ws',
      user: 'user_2',
      role: 'viewer',
    });
    context.collection.update.mockResolvedValue({ id: 'member_1' });

    await new WorkspaceMemberMutator(context.pb).add('ws', 'user_2', 'admin');

    expect(context.collection.update).toHaveBeenCalledWith('member_1', {
      role: 'admin',
    });
    expect(context.collection.create).not.toHaveBeenCalled();
  });
});

describe('GraphVersionMutator.publish', () => {
  let context: ReturnType<typeof setup>;

  const graph = makeGraph({ id: 'graph_1', uid: 'Boat' });
  const nodes = [makeNode({ id: 'n1', graph: 'graph_1', name: 'battery' })];

  beforeEach(() => {
    context = setup();
    vi.clearAllMocks();
  });

  it('numbers the first version 1', async () => {
    context.collection.getFirstListItem.mockRejectedValue(notFoundError());
    context.collection.create.mockResolvedValue({ id: 'v1', version: 1 });

    await new GraphVersionMutator(context.pb).publish(graph, nodes, []);

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1, createdBy: 'user_1' })
    );
  });

  it('increments from the current maximum', async () => {
    context.collection.getFirstListItem.mockResolvedValue(
      makeVersion(graph, [], [], { version: 7 })
    );
    context.collection.create.mockResolvedValue({ id: 'v8', version: 8 });

    await new GraphVersionMutator(context.pb).publish(graph, nodes, []);

    expect(context.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({ version: 8 })
    );
  });

  it('returns the existing version when nothing has changed', async () => {
    const latest = makeVersion(graph, nodes, [], { version: 3 });
    context.collection.getFirstListItem.mockResolvedValue(latest);

    const result = await new GraphVersionMutator(context.pb).publish(
      graph,
      nodes,
      []
    );

    // Publishing twice in a row should not mint v4 identical to v3 — a version
    // list that grows without the graph changing is noise a pinned importer
    // then has to read through.
    expect(result).toBe(latest);
    expect(context.collection.create).not.toHaveBeenCalled();
  });

  it('refuses to publish while signed out', async () => {
    const signedOut = setup(false);

    await expect(
      new GraphVersionMutator(signedOut.pb).publish(graph, nodes, [])
    ).rejects.toThrow(/signed out/i);
  });
});
