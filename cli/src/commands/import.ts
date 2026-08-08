// Import commands — composition by reference.
//
// The alias is the load-bearing field: unique per parent, and the reason the
// same child can be imported twice. Everything derived is keyed by the chain of
// aliases, which is why renaming one is a two-part operation (see `alias`).
import { Option, type Command } from 'commander';
import {
  AttributeOverrideMapSchema,
  isUnderAlias,
  rewriteAliasPrefix,
  type Graph,
  type GraphImport,
} from '@project/shared';
import type { Ctx } from '../context.ts';
import { addListOptions, fetchList, type ListOpts } from '../listing.ts';
import { nonNegativeInt } from '../options.ts';
import { ask, canPrompt } from '../prompt.ts';
import { addCheckOption, checkGraph, withDiagnostics } from '../render.ts';
import { readJsonArg, resolveGraph } from '../resolve-ref.ts';
import type { Runtime } from '../runtime.ts';

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

async function requireImport(ctx: Ctx, id: string): Promise<GraphImport> {
  const record = await ctx.imports.getById(id);
  if (!record) throw new Error(`No import "${id}".`);
  return record;
}

export async function ls(ctx: Ctx, opts: ListOpts, ref: string) {
  const graph = await resolveGraph(ctx, ref);
  const result = await fetchList(
    ctx.imports,
    `parent = "${graph.id}"`,
    opts,
    'child'
  );
  ctx.printer.list(result, columns, 'No imports.');
}

export interface ImportAddOpts {
  alias?: string;
  label?: string;
  order?: number;
  check?: boolean;
}

export async function add(
  ctx: Ctx,
  opts: ImportAddOpts,
  parentRef: string,
  childRef: string
) {
  const parent = await resolveGraph(ctx, parentRef);
  const child = await resolveGraph(ctx, childRef);

  const record = await ctx.imports.addImport(parent.id!, child.id!, {
    alias: opts.alias,
    label: opts.label,
    order: opts.order,
  });

  ctx.printer.note(
    `${parent.uid} imports ${child.uid} as "${record.alias}" (${record.id})`
  );
  const diagnostics = opts.check
    ? await checkGraph(ctx, parent.id!)
    : undefined;
  if (ctx.printer.json) ctx.printer.data(withDiagnostics(record, diagnostics));
}

export interface ImportSetOpts {
  label?: string;
  enable?: boolean;
  disable?: boolean;
  check?: boolean;
}

export async function set(ctx: Ctx, opts: ImportSetOpts, id: string) {
  const existing = await requireImport(ctx, id);

  const patch: Partial<GraphImport> = {};
  if (opts.label !== undefined) patch.label = opts.label;
  if (opts.enable) patch.enabled = true;
  if (opts.disable) patch.enabled = false;

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to change. Pass --label, --enable or --disable.');
  }

  const record = await ctx.imports.update(id, patch);
  ctx.printer.note(`Updated import ${record.alias}`);
  const diagnostics = opts.check
    ? await checkGraph(ctx, existing.parent)
    : undefined;
  if (ctx.printer.json) ctx.printer.data(withDiagnostics(record, diagnostics));
}

export interface AliasOpts {
  dryRun?: boolean;
}

export async function alias(
  ctx: Ctx,
  opts: AliasOpts,
  id: string,
  next: string
) {
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

  if (opts.dryRun) {
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
}

export interface MoveOpts {
  up?: boolean;
  down?: boolean;
}

export async function move(ctx: Ctx, opts: MoveOpts, id: string) {
  const record = await requireImport(ctx, id);

  if (!opts.up === !opts.down) {
    throw new Error('Pass exactly one of --up or --down');
  }

  const siblings = (await ctx.imports.listForParent(record.parent)).items
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const index = siblings.findIndex((s) => s.id === id);
  const target = index + (opts.up ? -1 : 1);
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

  ctx.printer.note(`Moved ${record.alias} ${opts.up ? 'up' : 'down'}`);
  if (ctx.printer.json) {
    ctx.printer.data(siblings.map((s) => ({ id: s.id, alias: s.alias })));
  }
}

export interface PinOpts {
  unpin?: boolean;
  check?: boolean;
}

export async function pin(
  ctx: Ctx,
  opts: PinOpts,
  id: string,
  versionRef?: string
) {
  if (!opts.unpin && !versionRef) {
    throw new Error('Pass a version id, or --unpin');
  }

  const record = await ctx.imports.setVersion(
    id,
    opts.unpin ? null : versionRef!
  );
  ctx.printer.note(
    opts.unpin
      ? `Unpinned ${record.alias}`
      : `Pinned ${record.alias} to ${versionRef}`
  );
  const diagnostics = opts.check
    ? await checkGraph(ctx, record.parent)
    : undefined;
  if (ctx.printer.json) ctx.printer.data(withDiagnostics(record, diagnostics));
}

export interface OverridesOpts {
  set?: string;
  clear?: boolean;
}

export async function overrides(ctx: Ctx, opts: OverridesOpts, id: string) {
  const record = await requireImport(ctx, id);

  if (!opts.set && !opts.clear) {
    ctx.printer.data(record.attributeOverrides ?? {});
    return;
  }

  const map = opts.clear
    ? {}
    : AttributeOverrideMapSchema.parse(await readJsonArg(opts.set!));
  const updated = await ctx.imports.setAttributeOverrides(id, map);

  ctx.printer.note(
    opts.clear
      ? `Cleared attribute overrides on ${record.alias}`
      : `Set ${Object.keys(map).length} attribute override target(s) on ${record.alias}`
  );
  if (ctx.printer.json) ctx.printer.data(updated);
}

export interface ImportRmOpts {
  yes?: boolean;
  check?: boolean;
}

export async function rm(ctx: Ctx, opts: ImportRmOpts, id: string) {
  const record = await requireImport(ctx, id);

  if (!opts.yes && canPrompt(ctx)) {
    const confirmed = await ask.confirm({
      message: `Remove import "${record.alias}"?`,
      default: false,
    });
    if (!confirmed) {
      ctx.printer.note('Cancelled.');
      return 1;
    }
  }

  await ctx.imports.delete(id);
  ctx.printer.note(`Removed import ${record.alias}`);
  const diagnostics = opts.check
    ? await checkGraph(ctx, record.parent)
    : undefined;
  if (ctx.printer.json) {
    ctx.printer.data(withDiagnostics({ id, alias: record.alias }, diagnostics));
  }
}

export function registerImport(program: Command, rt: Runtime): void {
  const importCmd = program
    .command('import')
    .summary('composition — importing one graph into another')
    .description(
      'Composition — importing one graph into another.\n\n' +
        'An import embeds a child graph under an alias unique within the parent.\n' +
        'The same child may be imported twice under two aliases, and everything\n' +
        'derived (nodes, edges, overrides) is addressed by the alias chain, so the\n' +
        'two copies stay distinct. Imports are referenced by their record id, shown\n' +
        'in `import ls`.'
    );

  addListOptions(
    importCmd
      .command('ls')
      .summary('list what a graph imports')
      .description('List what a graph imports, in display order.')
      .argument('<graph>', 'the parent graph (id or uid)')
  ).action(rt.act(ls));

  addCheckOption(
    importCmd
      .command('add')
      .summary('import one graph into another')
      .description(
        'Import one graph into another.\n\n' +
          'Rejects self-imports, cycles and chains deeper than the import limit —\n' +
          'the same refusals the server hook enforces. Without --alias, one is\n' +
          'derived from the child machine name and suffixed if it collides.'
      )
      .argument('<parent>', 'the importing graph (id or uid)')
      .argument('<child>', 'the graph to import (id or uid)')
      .option('--alias <alias>', 'instance alias, unique within the parent')
      .option('--label <label>', 'display label for this instance')
      .option('--order <n>', 'display order among siblings', nonNegativeInt)
  ).action(rt.act(add));

  addCheckOption(
    importCmd
      .command('set')
      .summary('update an import label or enabled state')
      .description(
        'Update an import. A disabled import stays declared but contributes\n' +
          'nothing to resolution — the reversible half of removing it.'
      )
      .argument('<importId>', 'the import record id')
      .option('--label <label>', 'display label')
      .addOption(
        new Option('--enable', 'enable the import').conflicts('disable')
      )
      .option('--disable', 'disable the import without removing it')
  ).action(rt.act(set));

  importCmd
    .command('alias')
    .summary('rename an import alias, rewriting the overrides beneath it')
    .description(
      'Rename an import alias.\n\n' +
        'Every edge override under the old alias is addressed by a path that starts\n' +
        'with it, so the rename is two writes: the import, then each affected\n' +
        'override. PocketBase has no multi-record transaction, so a failure\n' +
        'part-way leaves a partial rename — --dry-run first shows exactly what\n' +
        'would move, and a partial failure reports how far it got.'
    )
    .argument('<importId>', 'the import record id')
    .argument('<newAlias>', 'the new alias')
    .option('--dry-run', 'show what would be rewritten without writing')
    .action(rt.act(alias));

  importCmd
    .command('move')
    .summary('reorder an import among its siblings')
    .description('Move an import one step in the display order.')
    .argument('<importId>', 'the import record id')
    .addOption(new Option('--up', 'move one step earlier').conflicts('down'))
    .option('--down', 'move one step later')
    .action(rt.act(move));

  addCheckOption(
    importCmd
      .command('pin')
      .summary('pin an import to a published version, or unpin it')
      .description(
        'Pin an import to a published version of its child, or --unpin it.\n\n' +
          'A pin freezes one level: the child resolves from its snapshot, but that\n' +
          'snapshot names grandchildren by id, so they still resolve live.'
      )
      .argument('<importId>', 'the import record id')
      .argument('[versionId]', 'the GraphVersions record id to pin to')
      .option('--unpin', 'resolve the child live again')
  ).action(rt.act(pin));

  importCmd
    .command('overrides')
    .summary('read or replace an import attribute-override map')
    .description(
      'Read (no flags) or replace an import attribute-override map.\n\n' +
        'The map is written whole, last-write-wins. It is keyed by instance id\n' +
        'relative to the import, then attribute name, and can only replace values\n' +
        'that already exist on the node.'
    )
    .argument('<importId>', 'the import record id')
    .addOption(
      new Option(
        '--set <json|@file>',
        'replacement map, e.g. \'{"lamp":{"voltage":24}}\''
      ).conflicts('clear')
    )
    .option('--clear', 'drop every override on this import')
    .action(rt.act(overrides));

  addCheckOption(
    importCmd
      .command('rm')
      .summary('remove an import')
      .description(
        'Remove an import. On a TTY it asks first; --yes skips that. Edge\n' +
          'overrides addressed under its alias stop matching anything.'
      )
      .argument('<importId>', 'the import record id')
      .option('-y, --yes', 'skip the confirmation prompt')
  ).action(rt.act(rm));
}
