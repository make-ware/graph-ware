// Port-kind commands.
//
// Port kinds are what auto-connect matches on, so being able to read the
// registry is how you work out why two ports did not connect.
import type { Command } from 'commander';
import type { PortKind } from '@project/shared';
import type { Ctx } from '../context.ts';
import { addListOptions, fetchList, type ListOpts } from '../listing.ts';
import type { Runtime } from '../runtime.ts';

const columns = [
  { header: 'KEY', get: (k: PortKind) => k.key },
  { header: 'LABEL', get: (k: PortKind) => k.label ?? '' },
  { header: 'COLOR', get: (k: PortKind) => k.color ?? '' },
  {
    header: 'COMPATIBLE WITH',
    get: (k: PortKind) => (k.compatibleWith ?? []).join(' '),
  },
  {
    header: 'SCOPE',
    get: (k: PortKind) => (k.workspace ? 'workspace' : 'global'),
  },
];

export async function ls(ctx: Ctx, opts: ListOpts & { global?: boolean }) {
  const scope = opts.global
    ? 'workspace = ""'
    : `workspace = "${await ctx.workspaceId()}"`;
  const result = await fetchList(ctx.portKinds, scope, opts);
  ctx.printer.list(result, columns, 'No port kinds.');
}

export async function registry(ctx: Ctx) {
  ctx.printer.data(await ctx.portKinds.registry());
}

export function registerPortkind(program: Command, rt: Runtime): void {
  const portkind = program
    .command('portkind')
    .summary('port kinds — what auto-connect matches on')
    .description(
      'Port kinds — the vocabulary auto-connect matches on.\n\n' +
        'An output port connects to input ports of the same (or a declared\n' +
        'compatible) kind. Workspace rows shadow global rows of the same key.'
    );

  addListOptions(
    portkind
      .command('ls')
      .summary('list port kinds')
      .description(
        'List port kinds. Defaults to the active workspace kinds; --global lists\n' +
          'the ones shared across every workspace.'
      )
      .option('--global', 'list the global vocabulary instead')
  ).action(rt.act(ls));

  portkind
    .command('registry')
    .summary('show the resolved registry the engine matches against')
    .description(
      'Show the resolved registry: built-in defaults merged with the visible\n' +
        'rows. This is exactly what auto-connect consults, which makes it the\n' +
        'thing to check when an edge that should exist does not.'
    )
    .action(rt.act(registry));
}
