// Help, rendered from the registry. Nothing here is hand-written per command,
// so a new command cannot be added without also being documented.
import { GLOBAL_OPTIONS, type Command } from './command.ts';
import { isBareNoun, registry } from './registry.ts';

const GLOBAL_HELP = `Global flags:
  --json               Emit {"ok":true,"data":…} on stdout; errors on stderr
  --url <url>          PocketBase base URL (default $POCKETBASE_URL or http://localhost:8090)
  -w, --workspace <ref>  Act in this workspace (slug or id) for one command
  --no-color           Suppress ANSI (also automatic when stdout is not a terminal)
  -h, --help           Show help

Environment:
  POCKETBASE_URL         Server URL
  GRAPHWARE_EMAIL        Sign in non-interactively with…
  GRAPHWARE_PASSWORD     …these credentials, when no valid token is stored
  GRAPHWARE_TOKEN        Use this auth token directly, ahead of anything stored
  GRAPHWARE_WORKSPACE    Active workspace (slug or id)
  GRAPHWARE_CONFIG_DIR   Where auth.json lives (default ~/.config/graphware)
  GRAPHWARE_JSON=1       Same as --json
  NO_COLOR               Suppress ANSI`;

export function topLevelHelp(): string {
  const names = Object.keys(registry);
  const width = Math.max(...names.map((name) => name.length));

  const lines = names.map((name) => {
    const suffix = isBareNoun(name) ? '' : ' <command>';
    return `  ${(name + suffix).padEnd(width + 10)} ${registry[name].summary}`;
  });

  return [
    'graphware — drive the graph-ware builder from a terminal or an agent.',
    '',
    'Usage: graphware <command> [args] [flags]',
    '',
    lines.join('\n'),
    '',
    "Run `graphware <command> --help` for a command's own flags.",
    '',
    GLOBAL_HELP,
  ].join('\n');
}

export function nounHelp(name: string): string {
  const noun = registry[name];
  const verbs = Object.keys(noun.commands);
  const width = Math.max(...verbs.map((verb) => verb.length));

  const lines = verbs.map(
    (verb) => `  ${verb.padEnd(width + 2)} ${noun.commands[verb].summary}`
  );

  return [
    `${name} — ${noun.summary}`,
    '',
    `Usage: graphware ${name} <command> [args] [flags]`,
    '',
    lines.join('\n'),
    '',
    `Run \`graphware ${name} <command> --help\` for details.`,
  ].join('\n');
}

export function commandHelp(command: Command): string {
  const own = Object.keys(command.options).filter(
    (name) => !(name in GLOBAL_OPTIONS)
  );

  const parts = [command.summary, '', `Usage: ${command.usage}`];

  if (command.details) parts.push('', command.details);

  if (own.length) {
    const width = Math.max(...own.map((name) => name.length));
    parts.push(
      '',
      'Flags:',
      own
        .map((name) => {
          const spec = command.options[name] as {
            type: string;
            multiple?: boolean;
          };
          const value =
            spec.type === 'boolean'
              ? ''
              : spec.multiple
                ? ' <value>...'
                : ' <value>';
          return `  --${(name + value).padEnd(width + 10)}`.trimEnd();
        })
        .join('\n')
    );
  }

  parts.push('', GLOBAL_HELP);
  return parts.join('\n');
}
