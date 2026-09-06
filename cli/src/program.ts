// The command tree, assembled from the per-noun registrars.
//
// GraphwareCommand exists for one reason: every subcommand commander creates
// under it automatically carries the global flags, so `--json` works at the
// end of any invocation without each registrar having to remember it — and a
// structural test can assert it never regresses.
import { Command } from 'commander';
import { registerAuth } from './commands/auth.ts';
import { registerGraph } from './commands/graph.ts';
import { registerImport } from './commands/import.ts';
import { registerNode } from './commands/node.ts';
import { registerOverride } from './commands/override.ts';
import { registerPortkind } from './commands/portkind.ts';
import { registerResolve } from './commands/resolve.ts';
import { registerVersion } from './commands/version.ts';
import { registerWorkspace } from './commands/workspace.ts';
import { addGlobalOptions } from './options.ts';
import type { Runtime } from './runtime.ts';

// Replaced at build time by tsup's `define` (see cli/tsup*.config.ts), which
// reads the root package.json version — the one release-please bumps.
// `typeof` on an undeclared identifier is safe, so running from source via tsx
// (where nothing substitutes it) falls through to the dev sentinel.
declare const __GRAPHWARE_VERSION__: string;
export const VERSION =
  typeof __GRAPHWARE_VERSION__ === 'string'
    ? __GRAPHWARE_VERSION__
    : '0.0.0-dev';

class GraphwareCommand extends Command {
  createCommand(name?: string): GraphwareCommand {
    const command = new GraphwareCommand(name);
    addGlobalOptions(command);
    return command;
  }
}

const ROOT_HELP = `
Exit codes:
  0  success
  1  the operation failed (including lint/check finding errors)
  2  the command line was wrong

Environment:
  POCKETBASE_URL         server URL (--url overrides; default http://localhost:8090)
  GRAPHWARE_EMAIL        sign in automatically with these credentials
  GRAPHWARE_PASSWORD     when no valid token is stored
  GRAPHWARE_TOKEN        use this auth token directly, ahead of anything stored
  GRAPHWARE_WORKSPACE    active workspace (slug or id)
  GRAPHWARE_CONFIG_DIR   where auth.json lives (set it to isolate parallel agents)
  GRAPHWARE_JSON=1       same as --json
  NO_COLOR               suppress ANSI

Agents: pass --json for exactly one {"ok":true,"data":…} object on stdout, or
{"ok":false,"error":{type,message,fieldErrors}} on stderr. Unknown flags exit 2.
Prompts only ever happen on a TTY — headless invocations fail fast instead.

Start with:
  graphware login --email you@example.com
  graphware workspace use <slug>          # or -w <slug> per command
  graphware graph ls
  graphware resolve <graph>               # nodes, derived edges, diagnostics`;

/**
 * Build the full program. Root-level settings (exitOverride, output routing,
 * suggestion rendering) are configured *before* the registrars run, because
 * `.command()` copies them into each subcommand as it is created.
 */
export function buildProgram(rt: Runtime): Command {
  const program = new GraphwareCommand('graphware');

  program
    .description(
      'Drive the graph-ware builder from a terminal or an agent.\n\n' +
        'Components declare typed ports; the wiring between them is derived from\n' +
        'port compatibility, never stored. Build graphs (`graph`, `node`), compose\n' +
        'them (`import`), then read the result back (`resolve`, `lint`).'
    )
    .exitOverride()
    .allowExcessArguments(false)
    .showSuggestionAfterError()
    .showHelpAfterError('(run the command with --help for usage)')
    .configureOutput({
      // Under --json, stderr must stay parseable: main() re-emits commander
      // failures as {"ok":false,"error":{type:"usage",…}} instead of prose.
      writeErr: (text) => {
        if (!rt.printer.json) process.stderr.write(text);
      },
    })
    .version(VERSION, '--version', 'print the CLI version')
    .addHelpText('after', ROOT_HELP);
  addGlobalOptions(program);

  registerAuth(program, rt);
  registerWorkspace(program, rt);
  registerGraph(program, rt);
  registerNode(program, rt);
  registerImport(program, rt);
  registerOverride(program, rt);
  registerVersion(program, rt);
  registerResolve(program, rt);
  registerPortkind(program, rt);

  return program;
}
