// The bridge between commander and the commands: builds the Ctx once the
// global flags are known, establishes the session, runs the handler, and
// remembers the exit code for main() to return.
import type { Command } from 'commander';
import { ClientResponseError } from 'pocketbase';
import { createPocketBaseClient } from '@project/shared/client';
import { createFileAuthStore, DEFAULT_URL, readProfile } from './config.ts';
import { Ctx } from './context.ts';
import type { GlobalOpts } from './options.ts';
import type { Printer } from './output.ts';

const REQUEST_TIMEOUT = 30_000;

/**
 * A command implementation: positionals after the options, exactly as the
 * command declared its `.argument()`s. Returning a number sets the exit code;
 * returning nothing means success.
 */
export type Handler<O> = (
  ctx: Ctx,
  opts: O,
  ...positionals: string[]
) => Promise<number | void>;

export interface ActOptions {
  /** Default true. `login`, `register`, `logout` and `whoami` opt out. */
  requiresAuth?: boolean;
}

/** True for the one failure worth retrying: an expired token we can refresh. */
function isUnauthorized(error: unknown): boolean {
  return error instanceof ClientResponseError && error.status === 401;
}

export class Runtime {
  readonly printer: Printer;
  readonly env: NodeJS.ProcessEnv;
  readonly color: boolean;
  /** Set by the action that ran; EXIT_OK when it returned nothing. */
  exitCode = 0;

  private ctx?: Ctx;

  constructor(options: {
    printer: Printer;
    env: NodeJS.ProcessEnv;
    color: boolean;
  }) {
    this.printer = options.printer;
    this.env = options.env;
    this.color = options.color;
  }

  /**
   * Wrap a Handler as a commander action.
   *
   * Commander calls actions as `(...args, options, command)`; this trims that
   * back to `(ctx, opts, ...positionals)` with `opts` merged from the whole
   * command chain, so a handler never touches commander directly — which is
   * also what keeps handlers callable from tests with plain objects.
   */
  act<O>(handler: Handler<O>, options: ActOptions = {}) {
    const requiresAuth = options.requiresAuth !== false;

    return async (...raw: unknown[]): Promise<void> => {
      const command = raw[raw.length - 1] as Command;
      const positionals = raw.slice(0, -2) as string[];
      const opts = command.optsWithGlobals() as O & GlobalOpts;

      const ctx = await this.context(opts);
      await this.authenticate(ctx, requiresAuth);

      let result: number | void;
      try {
        result = await handler(ctx, opts, ...positionals);
      } catch (error) {
        // One retry, and only for an expired token: refresh, then run again.
        // Cheaper and more reliable than trying to predict expiry up front.
        if (!isUnauthorized(error) || !requiresAuth) throw error;
        const refreshed = await ctx.auth.refreshAuth();
        if (!refreshed) throw error;
        result = await handler(ctx, opts, ...positionals);
      }

      this.exitCode = typeof result === 'number' ? result : 0;
    };
  }

  /** Release anything that keeps the process alive after the result printed. */
  async dispose(): Promise<void> {
    // BaseMutator can hold realtime subscriptions open; without this the
    // process lingers after the command has printed its result.
    await this.ctx?.pb.realtime.unsubscribe().catch(() => {});
  }

  /** Build (once) the Ctx for this invocation from the resolved global flags. */
  private async context(opts: GlobalOpts): Promise<Ctx> {
    if (this.ctx) return this.ctx;

    const url = opts.url ?? this.env.POCKETBASE_URL ?? DEFAULT_URL;
    const profile = await readProfile(url, this.env);

    const pb = createPocketBaseClient(url, {
      // Same reason as the webapp: the SDK's cancel key is method + path, and
      // several shared helpers issue concurrent reads of one collection.
      enableAutoCancellation: false,
      requestTimeout: REQUEST_TIMEOUT,
      authStore: createFileAuthStore(url, profile.token, this.env),
    });

    this.ctx = new Ctx({
      pb,
      printer: this.printer,
      flags: {
        json: this.printer.json,
        url,
        workspace: opts.workspace,
        color: this.color,
      },
      env: this.env,
      storedWorkspace: profile.workspace,
    });
    return this.ctx;
  }

  /**
   * Establish a session before the command runs.
   *
   * Precedence is deliberate: an explicit token beats stored state, and stored
   * state beats env credentials, so a long-running agent is not
   * re-authenticating on every invocation.
   */
  private async authenticate(ctx: Ctx, requiresAuth: boolean): Promise<void> {
    const token = ctx.env.GRAPHWARE_TOKEN;
    if (token) {
      ctx.pb.authStore.save(token, null);
      // The token alone carries no record, and almost everything needs the
      // user id. One refresh hydrates it and proves the token is still good.
      await ctx.auth.refreshAuth();
    } else if (!ctx.pb.authStore.isValid) {
      const email = ctx.env.GRAPHWARE_EMAIL;
      const password = ctx.env.GRAPHWARE_PASSWORD;
      if (email && password) await ctx.auth.login(email, password);
    }

    if (!requiresAuth) return;

    if (!ctx.auth.isAuthenticated()) {
      throw new Error(
        'Not signed in. Run `graphware login`, or set GRAPHWARE_EMAIL and GRAPHWARE_PASSWORD.'
      );
    }
  }
}
