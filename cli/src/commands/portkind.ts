// Port-kind commands.
//
// Port kinds are what auto-connect matches on, so being able to read the
// registry is how you work out why two ports did not connect.
import type { PortKind } from '@project/shared';
import { bool, type Command } from '../command.ts';

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

export const ls: Command = {
  summary: 'List port kinds',
  usage: 'graphware portkind ls [--global]',
  details:
    'Defaults to the active workspace kinds. --global lists the ones shared\nacross every workspace.',
  options: {
    global: { type: 'boolean' },
  },
  async run(ctx, args) {
    const result = bool(args, 'global')
      ? await ctx.portKinds.listGlobal()
      : await ctx.portKinds.listForWorkspace(await ctx.workspaceId());
    ctx.printer.list(result.items, columns, 'No port kinds.');
  },
};

export const registry: Command = {
  summary: 'Show the resolved registry the engine matches against',
  usage: 'graphware portkind registry',
  details:
    'Built-in defaults merged with the visible rows — this is exactly what\nauto-connect consults, which makes it the thing to check when an edge that\nshould exist does not.',
  options: {},
  async run(ctx) {
    ctx.printer.data(await ctx.portKinds.registry());
  },
};
