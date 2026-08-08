// Workspace commands.
//
// A workspace is the access anchor for everything else — `Graphs.workspace` is
// required — so "which one am I in" is the first thing a session establishes.
import { Option, type Command } from 'commander';
import { WORKSPACE_ROLES, type Workspace } from '@project/shared';
import type { Ctx } from '../context.ts';
import { addListOptions, fetchList, type ListOpts } from '../listing.ts';
import { ask, canPrompt } from '../prompt.ts';
import type { Runtime } from '../runtime.ts';

async function requireWorkspace(ctx: Ctx, ref: string): Promise<Workspace> {
  const bySlug = await ctx.workspaces.getBySlug(ref);
  if (bySlug) return bySlug;
  const byId = await ctx.workspaces.getById(ref);
  if (byId) return byId;
  throw new Error(
    `No workspace "${ref}" that you can see. Run \`graphware workspace ls\`.`
  );
}

/** The active workspace, without failing when there isn't one. */
async function currentWorkspaceId(ctx: Ctx): Promise<string | undefined> {
  try {
    return await ctx.workspaceId();
  } catch {
    return undefined;
  }
}

export async function ls(ctx: Ctx) {
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
}

export async function use(ctx: Ctx, _opts: unknown, ref?: string) {
  // With no argument and a human attached, offer the memberships as a menu —
  // the slug is exactly the thing you run this command because you forgot.
  if (!ref) {
    if (!canPrompt(ctx)) {
      throw new Error(
        'Pass a workspace: `graphware workspace use <slug|id>`. See `graphware workspace ls`.'
      );
    }
    const memberships = await ctx.workspaces.listMine();
    if (!memberships.length) throw new Error('You belong to no workspaces.');
    ref = await ask.select({
      message: 'Active workspace:',
      choices: memberships.map((m) => ({
        name: `${m.workspace.slug} (${m.role})`,
        value: m.workspace.id,
      })),
    });
  }

  const workspace = await requireWorkspace(ctx, ref);

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
}

export async function show(ctx: Ctx, _opts: unknown, ref?: string) {
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
}

export async function members(ctx: Ctx, opts: ListOpts, ref?: string) {
  const workspaceId = ref
    ? (await requireWorkspace(ctx, ref)).id
    : await ctx.workspaceId();

  const result = await fetchList(
    ctx.members,
    `workspace = "${workspaceId}"`,
    opts,
    'user'
  );
  ctx.printer.list(
    result,
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
}

export interface AddMemberOpts {
  user?: string;
  role: string;
}

export async function addMember(ctx: Ctx, opts: AddMemberOpts, ref: string) {
  const workspace = await requireWorkspace(ctx, ref);
  if (!opts.user) throw new Error('--user <userId> is required');

  const role = opts.role as (typeof WORKSPACE_ROLES)[number];
  const member = await ctx.members.add(workspace.id, opts.user, role);
  ctx.printer.note(`${opts.user} is now a ${role} of ${workspace.slug}`);
  if (ctx.printer.json) ctx.printer.data(member);
}

export interface CreateOpts {
  name?: string;
  slug?: string;
  description?: string;
}

export async function create(ctx: Ctx, opts: CreateOpts) {
  let name = opts.name;
  if (!name && canPrompt(ctx)) {
    name = await ask.input({ message: 'Workspace name:' });
  }
  if (!name) throw new Error('--name is required');

  const slug = opts.slug ?? (await ctx.workspaces.availableSlug(name));
  const workspace = await ctx.workspaces.create({
    name,
    slug,
    description: opts.description,
    personal: false,
  });

  ctx.printer.note(`Created workspace ${workspace.slug}`);
  if (ctx.printer.json) ctx.printer.data(workspace);
}

export function registerWorkspace(program: Command, rt: Runtime): void {
  const workspace = program
    .command('workspace')
    .summary('workspaces and their members')
    .description(
      'Workspaces and their members.\n\n' +
        'Every graph lives in exactly one workspace, and your role there (admin,\n' +
        'member, viewer) is what decides whether you can write. The active workspace\n' +
        'is where listings default to and where new graphs go; set it once with\n' +
        '`workspace use`, or override per command with -w.'
    );

  workspace
    .command('ls')
    .summary('list the workspaces you belong to')
    .description(
      'List the workspaces you belong to, with the active one starred.\n\n' +
        'This is a membership join, not a plain collection read, so it does not take\n' +
        'the standard --filter/--sort/--page flags.'
    )
    .action(rt.act(ls));

  workspace
    .command('use')
    .summary('set the active workspace for this server')
    .description(
      'Set the active workspace for this server.\n\n' +
        'With no argument (and a terminal), your memberships are offered as a menu.\n' +
        'Membership is checked before the choice is stored, so a wrong slug fails\n' +
        'here rather than three commands later on a confusing permission error.'
    )
    .argument('[slug|id]', 'the workspace to activate')
    .action(rt.act(use));

  workspace
    .command('show')
    .summary('show one workspace')
    .description('Show one workspace. Defaults to the active one.')
    .argument('[slug|id]', 'the workspace to show (default: the active one)')
    .action(rt.act(show));

  addListOptions(
    workspace
      .command('members')
      .summary('list the members of a workspace')
      .description('List the members of a workspace (default: the active one).')
      .argument('[slug|id]', 'the workspace to list (default: the active one)')
  ).action(rt.act(members));

  workspace
    .command('add-member')
    .summary('add or re-role a workspace member')
    .description(
      'Add a member to a workspace, or change the role of an existing one.\n\n' +
        'Takes a user *id*, not an email: the Users read rule does not allow looking\n' +
        'someone up by address. Re-running with a different --role updates the seat.'
    )
    .argument('<slug|id>', 'the workspace to add to')
    .requiredOption('--user <userId>', 'the user record id to seat')
    .addOption(
      new Option('--role <role>', 'the role to grant')
        .choices([...WORKSPACE_ROLES])
        .default('member')
    )
    .action(rt.act(addMember));

  workspace
    .command('new')
    .summary('create a workspace')
    .description(
      'Create a workspace (you become its admin).\n\n' +
        'Without --slug the name is slugified, with a numeric suffix if that slug is\n' +
        'taken.'
    )
    .option('--name <name>', 'display name (prompted for on a TTY if omitted)')
    .option('--slug <slug>', 'URL-safe identifier')
    .option('--description <text>', 'what this workspace is for')
    .action(rt.act(create));
}
