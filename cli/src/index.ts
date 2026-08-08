// Entry point: parse, authenticate, dispatch, map the outcome to an exit code.
//
// Parsing happens twice on purpose. The first pass is lenient, only to find the
// noun, the verb and the global flags — it cannot be strict, because it does
// not yet know which command's options are legal. The second pass is strict
// against the resolved command, which is what turns a mistyped flag into a
// usage error instead of a silently ignored one.
import { parseArgs } from 'node:util';
import { ClientResponseError } from 'pocketbase';
import { createPocketBaseClient } from '@project/shared/client';
import { GLOBAL_OPTIONS, type Command, type ParsedArgs } from './command.ts';
import { createFileAuthStore, DEFAULT_URL, readProfile } from './config.ts';
import { Ctx, type GlobalFlags } from './context.ts';
import {
  describeError,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  suggest,
  UsageError,
} from './errors.ts';
import { commandHelp, nounHelp, topLevelHelp } from './help.ts';
import { Printer, shouldUseColor } from './output.ts';
import { isBareNoun, registry } from './registry.ts';

const VERSION = '0.0.0';
const REQUEST_TIMEOUT = 30_000;

interface Resolution {
  command: Command;
  /** Positional tokens the noun/verb themselves consumed: 1 or 2. */
  consumed: number;
}

/** Find the command the argv names, or throw a UsageError that suggests one. */
function resolveCommand(positionals: string[]): Resolution {
  const [noun, verb] = positionals;
  const entry = registry[noun];

  if (!entry) {
    const hint = suggest(noun, Object.keys(registry));
    throw new UsageError(
      `unknown command "${noun}"` + (hint ? `. Did you mean "${hint}"?` : '')
    );
  }

  if (isBareNoun(noun)) {
    return { command: entry.commands.run, consumed: 1 };
  }

  if (!verb) {
    throw new UsageError(
      `"${noun}" needs a subcommand: ${Object.keys(entry.commands).join(', ')}`
    );
  }

  const command = entry.commands[verb];
  if (!command) {
    const hint = suggest(verb, Object.keys(entry.commands));
    throw new UsageError(
      `unknown subcommand "${noun} ${verb}"` +
        (hint ? `. Did you mean "${noun} ${hint}"?` : '')
    );
  }

  return { command, consumed: 2 };
}

/**
 * The strict per-command parse, plus the required-positional check.
 *
 * This re-parses the *whole* argv, not the leftovers of the lenient pass —
 * that pass has already folded every flag into `values`, so parsing its
 * positionals would mean no flag was ever checked against the command and an
 * unknown one would sail through as exit 0.
 */
function parseCommandArgs(
  command: Command,
  argv: string[],
  consumed: number
): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(message, command.usage);
  }

  // Drop the noun and verb; what is left is the command's own arguments.
  const positionals = parsed.positionals.slice(consumed);

  const declared = command.positionals ?? [];
  const required = declared.filter((p) => p.required);
  if (positionals.length < required.length) {
    throw new UsageError(
      `missing required argument <${required[positionals.length].name}>`,
      command.usage
    );
  }
  if (positionals.length > declared.length) {
    throw new UsageError(
      `unexpected argument "${positionals[declared.length]}"`,
      command.usage
    );
  }

  return { values: parsed.values, positionals } as ParsedArgs;
}

/**
 * Establish a session before the command runs.
 *
 * Precedence is deliberate: an explicit token beats stored state, and stored
 * state beats env credentials, so a long-running agent is not re-authenticating
 * on every invocation.
 */
async function authenticate(ctx: Ctx, command: Command): Promise<void> {
  const token = ctx.env.GRAPHWARE_TOKEN;
  if (token) {
    ctx.pb.authStore.save(token, null);
    // The token alone carries no record, and almost everything needs the user
    // id. One refresh hydrates it and proves the token is still good.
    await ctx.auth.refreshAuth();
  } else if (!ctx.pb.authStore.isValid) {
    const email = ctx.env.GRAPHWARE_EMAIL;
    const password = ctx.env.GRAPHWARE_PASSWORD;
    if (email && password) await ctx.auth.login(email, password);
  }

  if (command.requiresAuth === false) return;

  if (!ctx.auth.isAuthenticated()) {
    throw new Error(
      'Not signed in. Run `graphware login`, or set GRAPHWARE_EMAIL and GRAPHWARE_PASSWORD.'
    );
  }
}

/** True for the one failure worth retrying: an expired token we can refresh. */
function isUnauthorized(error: unknown): boolean {
  return error instanceof ClientResponseError && error.status === 401;
}

export async function main(argv: string[]): Promise<number> {
  const env = process.env;

  // Lenient pre-parse: the command is not known yet, so unknown options must
  // not be fatal here — the strict pass below is what rejects them.
  let pre;
  try {
    pre = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, version: { type: 'boolean' } },
      allowPositionals: true,
      strict: false,
    });
  } catch {
    pre = { values: {}, positionals: [] as string[] };
  }

  const json = pre.values.json === true || env.GRAPHWARE_JSON === '1';
  const color = shouldUseColor(
    pre.values['no-color'] === true ? false : undefined,
    env
  );
  const printer = new Printer({ json, color });

  if (pre.values.version === true) {
    if (printer.json) printer.data({ version: VERSION });
    else printer.note(VERSION);
    return EXIT_OK;
  }

  if (pre.positionals.length === 0) {
    printer.note(topLevelHelp());
    // No arguments is a usage error, not success — an agent that pipes an empty
    // invocation should notice.
    return pre.values.help === true ? EXIT_OK : EXIT_USAGE;
  }

  let resolution: Resolution;
  try {
    resolution = resolveCommand(pre.positionals);
  } catch (error) {
    if (error instanceof UsageError) {
      // `graphware <noun> --help` for a noun with subcommands lands here only
      // when the verb is missing, which is exactly when the noun help is right.
      const noun = pre.positionals[0];
      if (pre.values.help === true && registry[noun]) {
        printer.note(nounHelp(noun));
        return EXIT_OK;
      }
      printer.usage(error.message, error.usage);
      return EXIT_USAGE;
    }
    throw error;
  }

  const { command, consumed } = resolution;

  if (pre.values.help === true) {
    printer.note(commandHelp(command));
    return EXIT_OK;
  }

  let args: ParsedArgs;
  try {
    args = parseCommandArgs(command, argv, consumed);
  } catch (error) {
    if (error instanceof UsageError) {
      printer.usage(error.message, error.usage);
      return EXIT_USAGE;
    }
    throw error;
  }

  const url =
    (args.values.url as string | undefined) ??
    env.POCKETBASE_URL ??
    DEFAULT_URL;

  const profile = await readProfile(url, env);
  const flags: GlobalFlags = {
    json,
    url,
    workspace: args.values.workspace as string | undefined,
    color,
  };

  const pb = createPocketBaseClient(url, {
    // Same reason as the webapp: the SDK's cancel key is method + path, and
    // several shared helpers issue concurrent reads of one collection.
    enableAutoCancellation: false,
    requestTimeout: REQUEST_TIMEOUT,
    authStore: createFileAuthStore(url, profile.token, env),
  });

  const ctx = new Ctx({
    pb,
    printer,
    flags,
    env,
    storedWorkspace: profile.workspace,
  });

  try {
    await authenticate(ctx, command);

    let result;
    try {
      result = await command.run(ctx, args);
    } catch (error) {
      // One retry, and only for an expired token: refresh, then run again.
      // Cheaper and more reliable than trying to predict expiry up front.
      if (!isUnauthorized(error) || command.requiresAuth === false) throw error;
      const refreshed = await ctx.auth.refreshAuth();
      if (!refreshed) throw error;
      result = await command.run(ctx, args);
    }

    return typeof result === 'number' ? result : EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) {
      printer.usage(error.message, error.usage ?? command.usage);
      return EXIT_USAGE;
    }
    printer.fail(describeError(error));
    return EXIT_FAILURE;
  } finally {
    // BaseMutator can hold realtime subscriptions open; without this the
    // process lingers after the command has printed its result.
    pb.realtime.unsubscribe().catch(() => {});
  }
}
