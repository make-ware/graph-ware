// Session commands.
//
// Nothing here saves a token by hand: the client was built with an
// AsyncAuthStore over the config file, so `authWithPassword` and
// `authStore.clear()` persist on their own.
import type { RegisterData, User } from '@project/shared';
import { bool, str, type Command } from '../command.ts';
import { dropProfile } from '../config.ts';
import { isInteractive, promptLine, promptSecret } from '../prompt.ts';
import type { Ctx } from '../context.ts';

/**
 * Credentials from flags, else the environment, else an interactive prompt.
 *
 * The non-interactive failure is explicit and early — see prompt.ts for why
 * hanging is the worst possible behaviour here.
 */
async function credentials(
  ctx: Ctx,
  email: string | undefined,
  password: string | undefined
): Promise<{ email: string; password: string }> {
  const resolvedEmail = email ?? ctx.env.GRAPHWARE_EMAIL;
  const resolvedPassword = password ?? ctx.env.GRAPHWARE_PASSWORD;
  if (resolvedEmail && resolvedPassword) {
    return { email: resolvedEmail, password: resolvedPassword };
  }

  if (!isInteractive()) {
    throw new Error(
      'No credentials and no terminal to ask on. Pass --email and --password, or set GRAPHWARE_EMAIL and GRAPHWARE_PASSWORD.'
    );
  }

  return {
    email: resolvedEmail ?? (await promptLine('Email: ')),
    password: resolvedPassword ?? (await promptSecret('Password: ')),
  };
}

const userFields: Array<[string, (user: User) => string]> = [
  ['id', (user) => user.id ?? ''],
  ['email', (user) => user.email ?? ''],
  ['name', (user) => user.name ?? ''],
];

export const login: Command = {
  summary: 'Sign in and remember the session for this server',
  usage: 'graphware login [--email <email>] [--password <password>]',
  details:
    'Falls back to $GRAPHWARE_EMAIL / $GRAPHWARE_PASSWORD, then to an interactive\nprompt. The token is written to auth.json (mode 0600) under the server URL.',
  requiresAuth: false,
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
  },
  async run(ctx, args) {
    const { email, password } = await credentials(
      ctx,
      str(args, 'email'),
      str(args, 'password')
    );
    const user = await ctx.auth.login(email, password);
    ctx.printer.note(`Signed in as ${user.email} on ${ctx.flags.url}`);
    if (ctx.printer.json) ctx.printer.data(user);
  },
};

export const logout: Command = {
  summary: 'Clear the stored session for this server',
  usage: 'graphware logout',
  requiresAuth: false,
  options: {},
  async run(ctx) {
    ctx.auth.logout();
    await dropProfile(ctx.flags.url, ctx.env);
    ctx.printer.note(`Signed out of ${ctx.flags.url}`);
    if (ctx.printer.json) ctx.printer.data({ url: ctx.flags.url });
  },
};

export const whoami: Command = {
  summary: 'Show the signed-in user',
  usage: 'graphware whoami [--refresh]',
  details:
    '--refresh re-validates the token against the server instead of trusting the\nstored one, and rewrites it if the server issued a new one.',
  requiresAuth: false,
  options: {
    refresh: { type: 'boolean' },
  },
  async run(ctx, args) {
    const user = bool(args, 'refresh')
      ? await ctx.auth.refreshAuth()
      : ctx.auth.getCurrentUser();

    if (!user) {
      ctx.printer.note('Not signed in.');
      if (ctx.printer.json) ctx.printer.data(null);
      return 1;
    }

    ctx.printer.detail(user, userFields);
  },
};

export const register: Command = {
  summary: 'Create an account and sign in',
  usage:
    'graphware register --email <email> --password <pw> --password-confirm <pw> [--name <name>]',
  details:
    'Signup provisions a personal workspace server-side, so the new account can\ncreate graphs immediately.',
  requiresAuth: false,
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    'password-confirm': { type: 'string' },
    name: { type: 'string' },
  },
  async run(ctx, args) {
    const email = str(args, 'email');
    const password = str(args, 'password');
    const passwordConfirm = str(args, 'password-confirm') ?? password;
    if (!email || !password) {
      throw new Error('--email and --password are required');
    }

    const data: RegisterData = {
      email,
      password,
      passwordConfirm: passwordConfirm ?? password,
      name: str(args, 'name') ?? email.split('@')[0],
    } as RegisterData;

    const user = await ctx.auth.register(data);
    ctx.printer.note(`Registered and signed in as ${user.email}`);
    if (ctx.printer.json) ctx.printer.data(user);
  },
};

export const passwd: Command = {
  summary: 'Change the signed-in user password',
  usage: 'graphware passwd --old <pw> --new <pw> [--confirm <pw>]',
  options: {
    old: { type: 'string' },
    new: { type: 'string' },
    confirm: { type: 'string' },
  },
  async run(ctx, args) {
    const oldPassword = str(args, 'old');
    const password = str(args, 'new');
    const confirm = str(args, 'confirm') ?? password;
    if (!oldPassword || !password) {
      throw new Error('--old and --new are required');
    }

    const userId = ctx.userId;
    if (!userId) throw new Error('Not signed in.');

    const user = await ctx.auth.changePassword(
      userId,
      oldPassword,
      password,
      confirm ?? password
    );
    ctx.printer.note('Password changed. The old session is no longer valid.');
    if (ctx.printer.json) ctx.printer.data(user);
  },
};

export const profileSet: Command = {
  summary: 'Update the signed-in user profile',
  usage: 'graphware profile set [--name <name>]',
  options: {
    name: { type: 'string' },
  },
  async run(ctx, args) {
    const name = str(args, 'name');
    if (name === undefined) throw new Error('Nothing to change. Pass --name.');

    const userId = ctx.userId;
    if (!userId) throw new Error('Not signed in.');

    const user = await ctx.auth.updateProfile(userId, {
      name,
    } as Partial<User>);
    ctx.printer.detail(user, userFields);
  },
};
