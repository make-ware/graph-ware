// Entry point: build the program, run it, map every outcome to an exit code.
//
// Commander owns parsing and help; what this file owns is the *contract*
// around it — the three exit codes, the single-JSON-object stdout/stderr
// under --json, and never leaving a realtime subscription holding the
// process open.
import { CommanderError } from 'commander';
import { describeError, EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './errors.ts';
import { Printer, shouldUseColor } from './output.ts';
import { buildProgram, VERSION } from './program.ts';
import { isPromptAbort } from './prompt.ts';
import { Runtime } from './runtime.ts';

/** Commander outcomes that are not failures at all. */
const CLEAN_EXITS = new Set(['commander.helpDisplayed', 'commander.version']);

/**
 * Strip commander's "error: " prefix; the JSON error envelope has a `type`
 * field carrying that information, and the human path prints its own prefix.
 */
function usageMessage(error: CommanderError): string {
  return error.message.replace(/^error:\s*/, '').trim();
}

export async function main(argv: string[]): Promise<number> {
  const env = process.env;

  // Read the output-shaping flags straight off argv, before any parsing: the
  // Printer (and commander's own error routing) must exist while the command
  // line is still potentially malformed.
  const json = argv.includes('--json') || env.GRAPHWARE_JSON === '1';
  const color = shouldUseColor(
    argv.includes('--no-color') ? false : undefined,
    env
  );
  const printer = new Printer({ json, color });

  if (argv.includes('--version')) {
    if (printer.json) printer.data({ version: VERSION });
    else printer.note(VERSION);
    return EXIT_OK;
  }

  const rt = new Runtime({ printer, env, color });
  const program = buildProgram(rt);

  try {
    await program.parseAsync(argv, { from: 'user' });
    return rt.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (CLEAN_EXITS.has(error.code)) return EXIT_OK;
      // Commander already wrote the prose rendering (suppressed under --json,
      // where the structured envelope below is the whole point).
      if (printer.json) {
        // 'commander.help' is the no-subcommand case; its message is the
        // internal marker '(outputHelp)', not something to show anyone.
        const message =
          error.code === 'commander.help'
            ? 'no command given'
            : usageMessage(error);
        printer.usage(message);
      }
      return EXIT_USAGE;
    }

    if (isPromptAbort(error)) {
      printer.note('Cancelled.');
      return EXIT_FAILURE;
    }

    printer.fail(describeError(error));
    return EXIT_FAILURE;
  } finally {
    await rt.dispose();
  }
}
