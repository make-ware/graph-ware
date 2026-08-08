// Structural tests over the registry.
//
// These are the ones that catch a *new* command breaking the contract, rather
// than an existing one regressing — which is the failure mode a hand-written
// per-command test suite always misses.
import { describe, expect, it } from 'vitest';
import { GLOBAL_OPTION_NAMES } from '../command.ts';
import { isBareNoun, registry } from '../registry.ts';
import { commandHelp, nounHelp, topLevelHelp } from '../help.ts';

const everyCommand = Object.entries(registry).flatMap(([noun, entry]) =>
  Object.entries(entry.commands).map(
    ([verb, command]) => [`${noun} ${verb}`.trim(), command] as const
  )
);

describe('registry', () => {
  it('is not empty', () => {
    expect(everyCommand.length).toBeGreaterThan(20);
  });

  it.each(everyCommand)('%s declares a usage line', (_name, command) => {
    expect(command.usage.trim()).not.toBe('');
    expect(command.usage.startsWith('graphware ')).toBe(true);
  });

  it.each(everyCommand)('%s declares a summary', (_name, command) => {
    expect(command.summary.trim()).not.toBe('');
  });

  // The whole agent contract is that --json works everywhere. A command that
  // redefined one of the global flags would shadow it for its own invocation
  // only, which is exactly the kind of inconsistency nobody notices by hand.
  it.each(everyCommand)(
    '%s does not shadow a global flag',
    (_name, command) => {
      for (const flag of Object.keys(command.options)) {
        expect(GLOBAL_OPTION_NAMES).not.toContain(flag);
      }
    }
  );

  it.each(everyCommand)('%s has a runnable handler', (_name, command) => {
    expect(typeof command.run).toBe('function');
  });

  // A required positional after an optional one can never be satisfied.
  it.each(everyCommand)('%s orders positionals soundly', (_name, command) => {
    const flags = (command.positionals ?? []).map((p) => Boolean(p.required));
    const firstOptional = flags.indexOf(false);
    if (firstOptional !== -1) {
      expect(flags.slice(firstOptional).every((required) => !required)).toBe(
        true
      );
    }
  });
});

describe('help', () => {
  it('lists every noun at the top level', () => {
    const text = topLevelHelp();
    for (const noun of Object.keys(registry)) {
      expect(text).toContain(noun);
    }
  });

  it('renders noun help for every noun with subcommands', () => {
    for (const noun of Object.keys(registry)) {
      if (isBareNoun(noun)) continue;
      const text = nounHelp(noun);
      for (const verb of Object.keys(registry[noun].commands)) {
        expect(text).toContain(verb);
      }
    }
  });

  it.each(everyCommand)('%s renders its own help', (_name, command) => {
    const text = commandHelp(command);
    expect(text).toContain(command.usage);
    expect(text).toContain('--json');
  });
});
