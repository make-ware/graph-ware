// Import commands — composition by reference.
//
// The alias is the load-bearing field: unique per parent, and the reason the
// same child can be imported twice. Everything derived is keyed by the chain of
// aliases, which is why renaming one is a two-part operation (see `alias`).
import {
  AttributeOverrideMapSchema,
  isUnderAlias,
  rewriteAliasPrefix,
  type Graph,
  type GraphImport,
} from '@project/shared';
import { bool, int, str, type Command } from '../command.ts';
import { readJsonArg, resolveGraph } from '../resolve-ref.ts';

const columns = [
  { header: 'ALIAS', get: (i: GraphImport) => i.alias },
  {
    header: 'CHILD',
    get: (i: GraphImport) =>
      (i.expand as { child?: Graph } | undefined)?.child?.uid ?? i.child,
  },
  { header: 'LABEL', get: (i: GraphImport) => i.label ?? '' },
  {
    header: 'ORDER',
    get: (i: GraphImport) => String(i.order ?? 0),
    align: 'right' as const,
  },
  { header: 'STATE', get: (i: GraphImport) => (i.enabled ? '' : 'disabled') },
  { header: 'PIN', get: (i: GraphImport) => i.version ?? '' },
  { header: 'ID', get: (i: GraphImport) => i.id ?? '' },
];

async function requireImport(
  ctx: import('../context.ts').Ctx,
  id: string
): Promise<GraphImport> {
  const record = await ctx.imports.getById(id);
  if (!record) throw new Error(`No import "${id}".`);
  return record;
}

export const ls: Command = {
  summary: 'List what a graph imports',
  usage: 'graphware import ls <graph>',
  positionals: [{ name: 'graph', required: true }],
  options: {},
  async run(ctx, args) {
    const graph = await resolveGraph(ctx, args.positionals[0]);
    const result = await ctx.imports.listForParent(graph.id!);
    ctx.printer.list(result.items, columns, 'No imports.');
  },
};

export const add: Command = {
  summary: 'Import one graph into another',
  usage:
    'graphware import add <parent> <child> [--alias <alias>] [--label <label>] [--order <n>]',
  details:
    'Rejects self-imports, cycles and chains deeper than the import limit — the\nsame refusals the server hook enforces. Without --alias, one is derived from\nthe child machine name and suffixed if it collides.',
  positionals: [
    { name: 'parent', required: true },
    { name: 'child', required: true },
  ],
  options: {
    alias: { type: 'string' },
    label: { type: 'string' },
    order: { type: 'string' },
  },
  async run(ctx, args) {
    const parent = await resolveGraph(ctx, args.positionals[0]);
    const child = await resolveGraph(ctx, args.positionals[1]);

    const record = await ctx.imports.addImport(parent.id!, child.id!, {
      alias: str(args, 'alias'),
      label: str(args, 'label'),
      order: int(args, 'order'),
    });

    ctx.printer.note(
      `${parent.uid} imports ${child.uid} as "${record.alias}" (${record.id})`
    );
    if (ctx.printer.json) ctx.printer.data(record);
  },
};

export const set: Command = {
  summary: 'Update an import label or enabled state',
  usage:
    'graphware import set <importId> [--label <label>] [--enable|--disable]',
  positionals: [{ name: 'importId', required: true }],
  options: {
    label: { type: 'string' },
    enable: { type: 'boolean' },
    disable: { type: 'boolean' },
  },
  async run(ctx, args) {
    const id = args.positionals[0];
    await requireImport(ctx, id);

    if (bool(args, 'enable') && bool(args, 'disable')) {
      throw new Error('--enable and --disable are mutually exclusive');
    }

    const patch: Partial<GraphImport> = {};
    if (str(args, 'label') !== undefined) patch.label = str(args, 'label');
    if (bool(args, 'enable')) patch.enabled = true;
    if (bool(args, 'disable')) patch.enabled = false;

    if (Object.keys(patch).length === 0) {
      throw new Error(
        'Nothing to change. Pass --label, --enable or --disable.'
      );
    }

    const record = await ctx.imports.update(id, patch);
    ctx.printer.note(`Updated import ${record.alias}`);
    if (ctx.printer.json) ctx.printer.data(record);
  },
};

export const alias: Command = {
  summary: 'Rename an import alias, rewriting the overrides beneath it',
  usage: 'graphware import alias <importId> <newAlias> [--dry-run]',
  details:
    'Every edge override under the old alias is addressed by a path that starts\nwith it, so the rename is two writes: the import, then each affected\noverride. PocketBase has no multi-record transaction, so a failure part-way\nleaves a partial rename — --dry-run first shows exactly what would move.',
  positionals: [
    { name: 'importId', required: true },
    { name: 'newAlias', required: true },
  ],
  options: {
    'dry-run': { type: 'boolean' },
  },
  async run(ctx, args) {
    const [id, next] = args.positionals;
    const record = await requireImport(ctx, id);
    const previous = record.alias;

    if (previous === next) {
      ctx.printer.note(`Already "${next}"; nothing to do.`);
      return;
    }

    const overrides = await ctx.overrides.listForGraph(record.parent);
    const affected = overrides.filter(
      (override) =>
        isUnderAlias(override.sourcePath, previous) ||
        isUnderAlias(override.targetPath, previous)
    );

    if (bool(args, 'dry-run')) {
      if (ctx.printer.json) {
        ctx.printer.data({
          import: record,
          from: previous,
          to: next,
          overrides: affected,
        });
        return;
      }
      ctx.printer.line(
        `Renaming "${previous}" → "${next}" would rewrite ${affected.length} override(s):`
      );
      for (const override of affected) {
        ctx.printer.line(
          `  ${override.sourcePath}:${override.sourcePort} → ${override.targetPath}:${override.targetPort}`
        );
      }
      return;
    }

    await ctx.imports.update(id, { alias: next });

    // Non-atomic on purpose — matching the editor. Count what actually landed
    // so a partial failure reports where it stopped instead of claiming success.
    let rewritten = 0;
    try {
      for (const override of affected) {
        await ctx.overrides.update(override.id!, {
          sourcePath: rewriteAliasPrefix(override.sourcePath, previous, next),
          targetPath: rewriteAliasPrefix(override.targetPath, previous, next),
        });
        rewritten++;
      }
    } catch (error) {
      ctx.printer.warn(
        `Renamed the import but only rewrote ${rewritten} of ${affected.length} override(s); the rest still point at "${previous}".`
      );
      throw error;
    }

    ctx.printer.note(
      `Renamed "${previous}" → "${next}"` +
        (affected.length ? `, rewrote ${rewritten} override(s)` : '')
    );
    if (ctx.printer.json) {
      ctx.printer.data({ id, from: previous, to: next, rewritten });
    }
  },
};

export const move: Command = {
  summary: 'Reorder an import among its siblings',
  usage: 'graphware import move <importId> --up|--down',
  positionals: [{ name: 'importId', required: true }],
  options: {
    up: { type: 'boolean' },
    down: { type: 'boolean' },
  },
  async run(ctx, args) {
    const id = args.positionals[0];
    const record = await requireImport(ctx, id);

    const up = bool(args, 'up');
    const down = bool(args, 'down');
    if (up === down) throw new Error('Pass exactly one of --up or --down');

    const siblings = (await ctx.imports.listForParent(record.parent)).items
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const index = siblings.findIndex((s) => s.id === id);
    const target = index + (up ? -1 : 1);
    if (index < 0 || target < 0 || target >= siblings.length) {
      ctx.printer.note('Already at the end; nothing to do.');
      return;
    }

    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];

    // Rewrite the whole list rather than swapping two `order` values: stored
    // orders are not guaranteed contiguous, so a swap can be a no-op.
    for (const [position, sibling] of siblings.entries()) {
      if (sibling.order !== position) {
        await ctx.imports.update(sibling.id!, { order: position });
      }
    }

    ctx.printer.note(`Moved ${record.alias} ${up ? 'up' : 'down'}`);
    if (ctx.printer.json) {
      ctx.printer.data(siblings.map((s) => ({ id: s.id, alias: s.alias })));
    }
  },
};

export const pin: Command = {
  summary: 'Pin an import to a published version, or unpin it',
  usage: 'graphware import pin <importId> <versionId|--unpin>',
  details:
    'A pin freezes one level: the child resolves from its snapshot, but that\nsnapshot names grandchildren by id, so they still resolve live.',
  positionals: [{ name: 'importId', required: true }, { name: 'versionId' }],
  options: {
    unpin: { type: 'boolean' },
  },
  async run(ctx, args) {
    const [id, versionRef] = args.positionals;
    const unpin = bool(args, 'unpin');
    if (!unpin && !versionRef) {
      throw new Error('Pass a version id, or --unpin');
    }

    const record = await ctx.imports.setVersion(id, unpin ? null : versionRef);
    ctx.printer.note(
      unpin
        ? `Unpinned ${record.alias}`
        : `Pinned ${record.alias} to ${versionRef}`
    );
    if (ctx.printer.json) ctx.printer.data(record);
  },
};

export const overrides: Command = {
  summary: 'Read or replace an import attribute-override map',
  usage: 'graphware import overrides <importId> [--set <json|@file> | --clear]',
  details:
    'The map is written whole, last-write-wins. It is keyed by instance id\nrelative to the import, then attribute name, and can only replace values that\nalready exist on the node.',
  positionals: [{ name: 'importId', required: true }],
  options: {
    set: { type: 'string' },
    clear: { type: 'boolean' },
  },
  async run(ctx, args) {
    const id = args.positionals[0];
    const record = await requireImport(ctx, id);

    const raw = str(args, 'set');
    const clear = bool(args, 'clear');
    if (raw && clear)
      throw new Error('--set and --clear are mutually exclusive');

    if (!raw && !clear) {
      ctx.printer.data(record.attributeOverrides ?? {});
      return;
    }

    const map = clear
      ? {}
      : AttributeOverrideMapSchema.parse(await readJsonArg(raw!));
    const updated = await ctx.imports.setAttributeOverrides(id, map);

    ctx.printer.note(
      clear
        ? `Cleared attribute overrides on ${record.alias}`
        : `Set ${Object.keys(map).length} attribute override target(s) on ${record.alias}`
    );
    if (ctx.printer.json) ctx.printer.data(updated);
  },
};

export const rm: Command = {
  summary: 'Remove an import',
  usage: 'graphware import rm <importId>',
  positionals: [{ name: 'importId', required: true }],
  options: {},
  async run(ctx, args) {
    const id = args.positionals[0];
    const record = await requireImport(ctx, id);
    await ctx.imports.delete(id);
    ctx.printer.note(`Removed import ${record.alias}`);
    if (ctx.printer.json) ctx.printer.data({ id, alias: record.alias });
  },
};
