// Workspace commands.
//
// A workspace is the access anchor for everything else — `Graphs.workspace` is
// required — so "which one am I in" is the first thing a session establishes.
import { WORKSPACE_ROLES, type Workspace } from '@project/shared';
import { str, type Command } from '../command.ts';
import type { Ctx } from '../context.ts';

async function requireWorkspace(ctx: Ctx, ref: string): Promise<Workspace> {
  const bySlug = await ctx.workspaces.getBySlug(ref);
  if (bySlug) return bySlug;
  const byId = await ctx.workspaces.getById(ref);
  if (byId) return byId;
  throw new Error(
    `No workspace "${ref}" that you can see. Run \`graphware workspace ls\`.`
  );
}

export const ls: Command = {
  summary: 'List the workspaces you belong to',
  usage: 'graphware workspace ls',
  options: {},
  async run(ctx) {
    const memberships = await ctx.workspaces.listMine();
    const active = await currentWorkspaceId(ctx);

    ctx.printer.list(
      memberships,
      [
        {
          header: '',
          get: (m) => (m.workspace.id === active ? '*' : ' '),
        },
        { header: 'SLUG', get: (m) => m.workspace.slug },
        { header: 'NAME', get: (m) => m.workspace.name },
        { header: 'ROLE', get: (m) => m.role },
        {
          header: 'PERSONAL',
          get: (m) => (m.workspace.personal ? 'yes' : ''),
        },
      ],
      'You belong to no workspaces.'
    );
  },
};

/** The active workspace, without failing when there isn't one. */
async function currentWorkspaceId(ctx: Ctx): Promise<string | undefined> {
  try {
    return await ctx.workspaceId();
  } catch {
    return undefined;
  }
}

export const use: Command = {
  summary: 'Set the active workspace for this server',
  usage: 'graphware workspace use <slug|id>',
  details:
    'Membership is checked before the choice is stored, so a wrong slug fails\nhere rather than three commands later on a confusing permission error.',
  positionals: [{ name: 'slug|id', required: true }],
  options: {},
  async run(ctx, args) {
    const workspace = await requireWorkspace(ctx, args.positionals[0]);

    // A workspace you can *read* is not necessarily one you can write to —
    // public graphs make other workspaces readable. Check the roll.
    const membership = await ctx.members.mine(workspace.id);
    const owns = workspace.owner === ctx.userId;
    if (!membership && !owns) {
      throw new Error(
        `You are not a member of "${workspace.slug}", so it cannot be your active workspace.`
      );
    }

    await ctx.rememberWorkspace(workspace.id);
    ctx.printer.note(`Active workspace: ${workspace.slug} (${workspace.name})`);
    if (ctx.printer.json) ctx.printer.data(workspace);
  },
};

export const show: Command = {
  summary: 'Show one workspace',
  usage: 'graphware workspace show [slug|id]',
  positionals: [{ name: 'slug|id' }],
  options: {},
  async run(ctx, args) {
    const ref = args.positionals[0];
    const workspace = ref
      ? await requireWorkspace(ctx, ref)
      : await ctx.workspaces.getById(await ctx.workspaceId());
    if (!workspace) throw new Error('No such workspace.');

    const membership = await ctx.members.mine(workspace.id);
    ctx.printer.detail({ ...workspace, role: membership?.role ?? 'owner' }, [
      ['id', (w) => w.id ?? ''],
      ['slug', (w) => w.slug],
      ['name', (w) => w.name],
      ['role', (w) => w.role],
      ['personal', (w) => (w.personal ? 'yes' : 'no')],
      ['description', (w) => w.description ?? ''],
    ]);
  },
};

export const members: Command = {
  summary: 'List the members of a workspace',
  usage: 'graphware workspace members [slug|id]',
  positionals: [{ name: 'slug|id' }],
  options: {},
  async run(ctx, args) {
    const ref = args.positionals[0];
    const workspaceId = ref
      ? (await requireWorkspace(ctx, ref)).id
      : await ctx.workspaceId();

    const result = await ctx.members.listForWorkspace(workspaceId);
    ctx.printer.list(
      result.items,
      [
        { header: 'USER', get: (m) => m.user },
        {
          header: 'EMAIL',
          get: (m) =>
            (m.expand as { user?: { email?: string } } | undefined)?.user
              ?.email ?? '',
        },
        { header: 'ROLE', get: (m) => m.role },
      ],
      'No members.'
    );
  },
};

export const addMember: Command = {
  summary: 'Add or re-role a workspace member',
  usage:
    'graphware workspace add-member <slug|id> --user <userId> [--role admin|member|viewer]',
  details:
    'Takes a user *id*, not an email: the Users read rule does not allow looking\nsomeone up by address. Re-running with a different --role updates the seat.',
  positionals: [{ name: 'slug|id', required: true }],
  options: {
    user: { type: 'string' },
    role: { type: 'string' },
  },
  async run(ctx, args) {
    const workspace = await requireWorkspace(ctx, args.positionals[0]);
    const userId = str(args, 'user');
    if (!userId) throw new Error('--user <userId> is required');

    const role = (str(args, 'role') ??
      'member') as (typeof WORKSPACE_ROLES)[number];
    if (!WORKSPACE_ROLES.includes(role)) {
      throw new Error(
        `--role must be one of ${WORKSPACE_ROLES.join(', ')}, got "${role}"`
      );
    }

    const member = await ctx.members.add(workspace.id, userId, role);
    ctx.printer.note(`${userId} is now a ${role} of ${workspace.slug}`);
    if (ctx.printer.json) ctx.printer.data(member);
  },
};

export const create: Command = {
  summary: 'Create a workspace',
  usage:
    'graphware workspace new --name <name> [--slug <slug>] [--description <text>]',
  details:
    'Without --slug the name is slugified and a numeric suffix added if that slug\nis taken.',
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
  },
  async run(ctx, args) {
    const name = str(args, 'name');
    if (!name) throw new Error('--name is required');

    const slug =
      str(args, 'slug') ?? (await ctx.workspaces.availableSlug(name));
    const workspace = await ctx.workspaces.create({
      name,
      slug,
      description: str(args, 'description'),
      personal: false,
    });

    ctx.printer.note(`Created workspace ${workspace.slug}`);
    if (ctx.printer.json) ctx.printer.data(workspace);
  },
};
