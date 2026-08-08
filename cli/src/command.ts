// The Command shape, and the option set every command inherits.
//
// `options` is a `node:util.parseArgs` config, which is the whole reason there
// is no argument-parsing dependency here: parseArgs already gives `--flag=value`,
// short aliases, `multiple`, and — the part that matters for agents — strict
// rejection of unknown options, so a typo is exit 2 rather than silently ignored.
import type { ParseArgsConfig } from 'node:util';
import type { Ctx } from './context.ts';

export type OptionConfig = NonNullable<ParseArgsConfig['options']>;

export interface ParsedArgs {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
}

export interface Positional {
  name: string;
  required?: boolean;
}

export interface Command {
  /** One line, shown in `graphware help` and the noun's own help. */
  summary: string;
  /** The full invocation, shown on usage errors. Must not be empty. */
  usage: string;
  /** Optional prose shown by `graphware <noun> <verb> --help`. */
  details?: string;
  positionals?: Positional[];
  options: OptionConfig;
  /** Default true. `login`, `register` and `help` set it false. */
  requiresAuth?: boolean;
  run(ctx: Ctx, args: ParsedArgs): Promise<number | void>;
}

export interface Noun {
  summary: string;
  commands: Record<string, Command>;
}

export type Registry = Record<string, Noun>;

/**
 * Flags accepted by every command. Merged into each command's own `options`
 * before the strict parse, so `--json` works everywhere without each command
 * having to remember it — and the registry test asserts no command shadows one.
 */
export const GLOBAL_OPTIONS = {
  json: { type: 'boolean' },
  url: { type: 'string' },
  workspace: { type: 'string', short: 'w' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies OptionConfig;

export const GLOBAL_OPTION_NAMES = Object.keys(GLOBAL_OPTIONS);

/** Read a string-valued flag, rejecting the `--flag --other` mistake. */
export function str(args: ParsedArgs, name: string): string | undefined {
  const value = args.values[name];
  if (value === undefined) return undefined;
  return String(value);
}

export function bool(args: ParsedArgs, name: string): boolean {
  return args.values[name] === true;
}

export function int(
  args: ParsedArgs,
  name: string,
  fallback?: number
): number | undefined {
  const raw = str(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a number, got "${raw}"`);
  }
  return value;
}
