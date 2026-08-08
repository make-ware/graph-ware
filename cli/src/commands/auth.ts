// Session commands.
//
// Nothing here saves a token by hand: the client was built with an
// AsyncAuthStore over the config file, so `authWithPassword` and
// `authStore.clear()` persist on their own.
import type { Command } from 'commander';
import type { RegisterData, User } from '@project/shared';
import { dropProfile } from './../config.ts';
import type { Ctx } from '../context.ts';
import { ask, canPrompt } from '../prompt.ts';
import type { Runtime } from '../runtime.ts';

const userFields: Array<[string, (user: User) => string]> = [
  ['id', (user) => user.id ?? ''],
  ['email', (user) => user.email ?? ''],
  ['name', (user) => user.name ?? ''],
];

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

  if (!canPrompt(ctx)) {
    throw new Error(
      'No credentials and no terminal to ask on. Pass --email and --password, or set GRAPHWARE_EMAIL and GRAPHWARE_PASSWORD.'
    );
  }

  return {
    email: resolvedEmail ?? (await ask.input({ message: 'Email:' })),
    password:
      resolvedPassword ?? (await ask.password({ message: 'Password:' })),
  };
}

export interface LoginOpts {
  email?: string;
  password?: string;
}

export async function login(ctx: Ctx, opts: LoginOpts) {
  const { email, password } = await credentials(ctx, opts.email, opts.password);
  const user = await ctx.auth.login(email, password);
  ctx.printer.note(`Signed in as ${user.email} on ${ctx.flags.url}`);
  if (ctx.printer.json) ctx.printer.data(user);
}

export async function logout(ctx: Ctx) {
  ctx.auth.logout();
  await dropProfile(ctx.flags.url, ctx.env);
  ctx.printer.note(`Signed out of ${ctx.flags.url}`);
  if (ctx.printer.json) ctx.printer.data({ url: ctx.flags.url });
}

export async function whoami(ctx: Ctx, opts: { refresh?: boolean }) {
  const user = opts.refresh
    ? await ctx.auth.refreshAuth()
    : ctx.auth.getCurrentUser();

  if (!user) {
    ctx.printer.note('Not signed in.');
    if (ctx.printer.json) ctx.printer.data(null);
    return 1;
  }

  ctx.printer.detail(user, userFields);
}

export interface RegisterOpts {
  email?: string;
  password?: string;
  passwordConfirm?: string;
  name?: string;
}

export async function register(ctx: Ctx, opts: RegisterOpts) {
  let { email, password } = opts;
  if ((!email || !password) && canPrompt(ctx)) {
    email = email ?? (await ask.input({ message: 'Email:' }));
    password = password ?? (await ask.password({ message: 'Password:' }));
  }
  if (!email || !password) {
    throw new Error('--email and --password are required');
  }

  const data: RegisterData = {
    email,
    password,
    passwordConfirm: opts.passwordConfirm ?? password,
    name: opts.name ?? email.split('@')[0],
  } as RegisterData;

  const user = await ctx.auth.register(data);
  ctx.printer.note(`Registered and signed in as ${user.email}`);
  if (ctx.printer.json) ctx.printer.data(user);
}

export interface PasswdOpts {
  old?: string;
  new?: string;
  confirm?: string;
}

export async function passwd(ctx: Ctx, opts: PasswdOpts) {
  let oldPassword = opts.old;
  let password = opts.new;
  if ((!oldPassword || !password) && canPrompt(ctx)) {
    oldPassword =
      oldPassword ?? (await ask.password({ message: 'Current password:' }));
    password = password ?? (await ask.password({ message: 'New password:' }));
  }
  if (!oldPassword || !password) {
    throw new Error('--old and --new are required');
  }

  const userId = ctx.userId;
  if (!userId) throw new Error('Not signed in.');

  const user = await ctx.auth.changePassword(
    userId,
    oldPassword,
    password,
    opts.confirm ?? password
  );
  ctx.printer.note('Password changed. The old session is no longer valid.');
  if (ctx.printer.json) ctx.printer.data(user);
}

export async function profileSet(ctx: Ctx, opts: { name?: string }) {
  if (opts.name === undefined) {
    throw new Error('Nothing to change. Pass --name.');
  }

  const userId = ctx.userId;
  if (!userId) throw new Error('Not signed in.');

  const user = await ctx.auth.updateProfile(userId, {
    name: opts.name,
  } as Partial<User>);
  ctx.printer.detail(user, userFields);
}

export function registerAuth(program: Command, rt: Runtime): void {
  program
    .command('login')
    .summary('sign in and remember the session for this server')
    .description(
      'Sign in and remember the session for this server.\n\n' +
        'Credentials come from the flags, then $GRAPHWARE_EMAIL / $GRAPHWARE_PASSWORD,\n' +
        'then an interactive prompt (TTY only — without one this fails immediately\n' +
        'instead of hanging). The token is written to auth.json (mode 0600), keyed by\n' +
        'server URL, so sessions against staging and production coexist.'
    )
    .option('--email <email>', 'account email')
    .option('--password <password>', 'account password')
    .action(rt.act(login, { requiresAuth: false }));

  program
    .command('logout')
    .summary('clear the stored session for this server')
    .description(
      'Clear the stored session for this server (other servers keep theirs).'
    )
    .action(rt.act(logout, { requiresAuth: false }));

  program
    .command('whoami')
    .summary('show the signed-in user')
    .description(
      'Show the signed-in user. Exits 1 when not signed in.\n\n' +
        '--refresh re-validates the token against the server instead of trusting the\n' +
        'stored one, and rewrites it if the server issued a new one.'
    )
    .option('--refresh', 're-validate the token against the server')
    .action(rt.act(whoami, { requiresAuth: false }));

  program
    .command('register')
    .summary('create an account and sign in')
    .description(
      'Create an account and sign in.\n\n' +
        'Signup provisions a personal workspace server-side, so the new account can\n' +
        'create graphs immediately. Missing credentials are prompted for on a TTY.'
    )
    .option('--email <email>', 'account email')
    .option('--password <password>', 'account password (min 8 characters)')
    .option(
      '--password-confirm <password>',
      'confirmation (defaults to --password)'
    )
    .option('--name <name>', 'display name (defaults to the email local part)')
    .action(rt.act(register, { requiresAuth: false }));

  program
    .command('passwd')
    .summary('change the signed-in user password')
    .description(
      'Change the signed-in user password. Missing passwords are prompted for on\n' +
        'a TTY. The stored session is invalidated by the server afterwards.'
    )
    .option('--old <password>', 'current password')
    .option('--new <password>', 'new password')
    .option('--confirm <password>', 'confirmation (defaults to --new)')
    .action(rt.act(passwd));

  const profile = program
    .command('profile')
    .summary('your user profile')
    .description('Read and update your user profile.');

  profile
    .command('set')
    .summary('update the signed-in user profile')
    .description('Update the signed-in user profile.')
    .option('--name <name>', 'display name')
    .action(rt.act(profileSet));
}
