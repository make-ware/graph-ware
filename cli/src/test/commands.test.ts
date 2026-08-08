// Command behaviour, asserted against stub mutators.
//
// The Ctx is faked rather than driven through a mock PocketBase: what these
// tests are about is *which mutator calls a command makes*, and going through
// the SDK would only add a layer to assert around.
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../context.ts';
import type { Command, ParsedArgs } from '../command.ts';
import { Printer } from '../output.ts';
import * as graph from '../commands/graph.ts';
import * as importCmd from '../commands/import.ts';
import * as node from '../commands/node.ts';
import * as version from '../commands/version.ts';

function args(positionals: string[], values: ParsedArgs['values'] = {}) {
  return { positionals, values } as ParsedArgs;
}

function harness(overrides: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const printer = new Printer({
    json: false,
    color: false,
    width: 200,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });

  const ctx = {
    printer,
    env: {},
    flags: { json: false, url: 'http://localhost:8090', color: false },
    userId: 'user1',
    workspaceId: vi.fn(async () => 'ws1'),
    lookupWorkspace: vi.fn(async (ref: string) => ref),
    rememberWorkspace: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Ctx;

  return { ctx, out, err };
}

const run = (command: Command, ctx: Ctx, a: ParsedArgs) => command.run(ctx, a);

const SAMPLE_GRAPH = {
  id: 'g1',
  uid: 'LightSwitch',
  name: 'light_switch',
  label: 'Light Switch',
  visibility: 'private' as const,
};

describe('graph ls', () => {
  it('lists the active workspace by default', async () => {
    const listForWorkspace = vi.fn(async () => ({ items: [SAMPLE_GRAPH] }));
    const { ctx, out } = harness({
      graphs: { listForWorkspace, listPublic: vi.fn(), listMine: vi.fn() },
    });

    await run(graph.ls, ctx, args([]));

    expect(listForWorkspace).toHaveBeenCalledWith('ws1');
    expect(out[0]).toContain('LightSwitch');
  });

  // searchPublic pre-filters tags with `~`, which matches substrings — the
  // command has to narrow to exact matches or "power" returns "powertrain".
  it('narrows tag matches to exact after the server prefilter', async () => {
    const searchPublic = vi.fn(async () => ({
      items: [
        { ...SAMPLE_GRAPH, uid: 'Exact', tags: ['power'] },
        { ...SAMPLE_GRAPH, uid: 'Substring', tags: ['powertrain'] },
      ],
    }));
    const { ctx, out } = harness({ graphs: { searchPublic } });

    await run(graph.ls, ctx, args([], { tag: ['power'] }));

    expect(out[0]).toContain('Exact');
    expect(out[0]).not.toContain('Substring');
  });
});

describe('graph rm', () => {
  it('refuses without --force while other graphs import it', async () => {
    const del = vi.fn();
    const { ctx } = harness({
      graphs: {
        getFirstByFilter: vi.fn(async () => SAMPLE_GRAPH),
        countImporters: vi.fn(async () => 3),
        delete: del,
      },
    });

    await expect(run(graph.rm, ctx, args(['g1']))).rejects.toThrow(
      /imported by 3/
    );
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes with --force', async () => {
    const del = vi.fn(async () => true);
    const { ctx } = harness({
      graphs: {
        getFirstByFilter: vi.fn(async () => SAMPLE_GRAPH),
        countImporters: vi.fn(async () => 3),
        delete: del,
      },
    });

    await run(graph.rm, ctx, args(['g1'], { force: true }));
    expect(del).toHaveBeenCalledWith('g1');
  });
});

describe('import alias', () => {
  const IMPORT = { id: 'i1', parent: 'g1', child: 'g2', alias: 'old' };
  const OVERRIDES = [
    {
      id: 'o1',
      sourcePath: 'old/lamp',
      sourcePort: 'out',
      targetPath: 'other/sw',
      targetPort: 'in',
    },
    {
      id: 'o2',
      sourcePath: 'other/sw',
      sourcePort: 'out',
      targetPath: 'old/lamp',
      targetPort: 'in',
    },
    {
      id: 'o3',
      sourcePath: 'unrelated/a',
      sourcePort: 'out',
      targetPath: 'unrelated/b',
      targetPort: 'in',
    },
  ];

  function aliasHarness() {
    const importUpdate = vi.fn(async () => ({ ...IMPORT, alias: 'new' }));
    const overrideUpdate = vi.fn(async (id: string) => ({ id }));
    const { ctx, out, err } = harness({
      imports: { getById: vi.fn(async () => IMPORT), update: importUpdate },
      overrides: {
        listForGraph: vi.fn(async () => OVERRIDES),
        update: overrideUpdate,
      },
    });
    return { ctx, out, err, importUpdate, overrideUpdate };
  }

  // The load-bearing case: a rename is two writes, and forgetting the second
  // silently orphans every override beneath the alias.
  it('renames the import and rewrites both endpoints beneath it', async () => {
    const { ctx, importUpdate, overrideUpdate } = aliasHarness();

    await run(importCmd.alias, ctx, args(['i1', 'new']));

    expect(importUpdate).toHaveBeenCalledWith('i1', { alias: 'new' });
    expect(overrideUpdate).toHaveBeenCalledTimes(2);
    expect(overrideUpdate).toHaveBeenCalledWith('o1', {
      sourcePath: 'new/lamp',
      targetPath: 'other/sw',
    });
    expect(overrideUpdate).toHaveBeenCalledWith('o2', {
      sourcePath: 'other/sw',
      targetPath: 'new/lamp',
    });
  });

  it('leaves overrides that do not sit under the alias alone', async () => {
    const { ctx, overrideUpdate } = aliasHarness();
    await run(importCmd.alias, ctx, args(['i1', 'new']));
    expect(overrideUpdate.mock.calls.map(([id]) => id)).not.toContain('o3');
  });

  it('writes nothing under --dry-run', async () => {
    const { ctx, out, importUpdate, overrideUpdate } = aliasHarness();

    await run(importCmd.alias, ctx, args(['i1', 'new'], { 'dry-run': true }));

    expect(importUpdate).not.toHaveBeenCalled();
    expect(overrideUpdate).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain('2 override(s)');
  });

  it('reports how far it got when an override rewrite fails', async () => {
    const { ctx, err, overrideUpdate } = aliasHarness();
    overrideUpdate.mockRejectedValueOnce(new Error('permission denied'));

    await expect(
      run(importCmd.alias, ctx, args(['i1', 'new']))
    ).rejects.toThrow('permission denied');
    expect(err.join('\n')).toContain('only rewrote 0 of 2');
  });

  it('does nothing when the alias is unchanged', async () => {
    const { ctx, importUpdate } = aliasHarness();
    await run(importCmd.alias, ctx, args(['i1', 'old']));
    expect(importUpdate).not.toHaveBeenCalled();
  });
});

describe('import move', () => {
  // Stored `order` values are not guaranteed contiguous, so swapping two of
  // them can be a no-op. The whole list has to be rewritten.
  it('renumbers the whole sibling list', async () => {
    const update = vi.fn(async () => ({}));
    const { ctx } = harness({
      imports: {
        getById: vi.fn(async () => ({ id: 'i2', parent: 'g1', alias: 'b' })),
        listForParent: vi.fn(async () => ({
          items: [
            { id: 'i1', alias: 'a', order: 0 },
            { id: 'i2', alias: 'b', order: 5 },
            { id: 'i3', alias: 'c', order: 9 },
          ],
        })),
        update,
      },
    });

    await run(importCmd.move, ctx, args(['i2'], { up: true }));

    expect(update).toHaveBeenCalledWith('i2', { order: 0 });
    expect(update).toHaveBeenCalledWith('i1', { order: 1 });
    expect(update).toHaveBeenCalledWith('i3', { order: 2 });
  });

  it('rejects --up with --down', async () => {
    const { ctx } = harness({
      imports: {
        getById: vi.fn(async () => ({ id: 'i1', parent: 'g1', alias: 'a' })),
      },
    });
    await expect(
      run(importCmd.move, ctx, args(['i1'], { up: true, down: true }))
    ).rejects.toThrow(/exactly one/);
  });
});

describe('node set', () => {
  // An undefined key is dropped from the request body, so clearing a position
  // has to send an explicit null or the stored one survives.
  it('sends an explicit null for --clear-position', async () => {
    const update = vi.fn(async () => ({ name: 'lamp' }));
    const { ctx } = harness({
      nodes: { getById: vi.fn(async () => ({ id: 'n1' })), update },
    });

    await run(node.set, ctx, args(['n1'], { 'clear-position': true }));

    expect(update).toHaveBeenCalledWith('n1', { position: null });
  });

  it('parses the x,y shorthand', async () => {
    const update = vi.fn(async () => ({ name: 'lamp' }));
    const { ctx } = harness({
      nodes: { getById: vi.fn(async () => ({ id: 'n1' })), update },
    });

    await run(node.set, ctx, args(['n1'], { position: '10,-20' }));

    expect(update).toHaveBeenCalledWith('n1', { position: { x: 10, y: -20 } });
  });

  it('refuses a no-op update rather than issuing an empty write', async () => {
    const update = vi.fn();
    const { ctx } = harness({
      nodes: { getById: vi.fn(async () => ({ id: 'n1' })), update },
    });

    await expect(run(node.set, ctx, args(['n1']))).rejects.toThrow(
      /Nothing to change/
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('version publish', () => {
  // publish() returns the existing latest when nothing changed. Saying
  // "published v3" when v3 already existed is a lie the caller would act on.
  it('says nothing was published when the snapshot matched', async () => {
    const latest = { id: 'v3', version: 3 };
    const { ctx, out } = harness({
      graphs: { getFirstByFilter: vi.fn(async () => SAMPLE_GRAPH) },
      nodes: { listForGraph: vi.fn(async () => ({ items: [] })) },
      imports: { listForParent: vi.fn(async () => ({ items: [] })) },
      versions: {
        latestForGraph: vi.fn(async () => latest),
        publish: vi.fn(async () => latest),
      },
    });

    await run(version.publish, ctx, args(['g1']));
    expect(out.join('\n')).toContain('nothing published');
  });

  it('reports the new version when one was minted', async () => {
    const { ctx, out } = harness({
      graphs: { getFirstByFilter: vi.fn(async () => SAMPLE_GRAPH) },
      nodes: { listForGraph: vi.fn(async () => ({ items: [] })) },
      imports: { listForParent: vi.fn(async () => ({ items: [] })) },
      versions: {
        latestForGraph: vi.fn(async () => ({ id: 'v3', version: 3 })),
        publish: vi.fn(async () => ({ id: 'v4', version: 4 })),
      },
    });

    await run(version.publish, ctx, args(['g1']));
    expect(out.join('\n')).toContain('Published v4');
  });
});
