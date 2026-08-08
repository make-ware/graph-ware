// The option vocabulary shared across the command tree.
//
// Commander does the parsing; what lives here is the *contract*: the global
// flags every command accepts, the standard listing flags every `ls`-style
// command accepts, and the argument parsers that turn "not a number" into a
// usage error (exit 2) instead of NaN reaching a mutator.
import { Command, InvalidArgumentError } from 'commander';

/** The global flags, as commander camelCases them into `optsWithGlobals()`. */
export interface GlobalOpts {
  json?: boolean;
  url?: string;
  workspace?: string;
  /** `--no-color` — commander stores the negation under the positive name. */
  color?: boolean;
}

export const GLOBAL_OPTION_FLAGS = [
  '--json',
  '--url',
  '--workspace',
  '--no-color',
] as const;

/**
 * Added to the root *and* to every leaf, so `graphware --json graph ls` and
 * `graphware graph ls --json` both work. Read them with `optsWithGlobals()`.
 */
export function addGlobalOptions(command: Command): Command {
  return command
    .option(
      '--json',
      'machine output: {"ok":true,"data":…} on stdout, {"ok":false,"error":…} on stderr'
    )
    .option(
      '--url <url>',
      'PocketBase base URL (default: $POCKETBASE_URL, else http://localhost:8090)'
    )
    .option(
      '-w, --workspace <ref>',
      'act in this workspace (slug or id) for this command only'
    )
    .option(
      '--no-color',
      'suppress ANSI colors (automatic when stdout is not a terminal)'
    );
}

/** `--page`/`--per-page` values: a whole number of at least 1. */
export function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(
      `expected a positive integer, got "${value}"`
    );
  }
  return parsed;
}

/** `--depth`/`--order` values: any whole number ≥ 0. */
export function nonNegativeInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError(
      `expected a non-negative integer, got "${value}"`
    );
  }
  return parsed;
}
