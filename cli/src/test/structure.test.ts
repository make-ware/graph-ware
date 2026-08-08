// Structural tests over the commander tree, plus the exit-code contract.
//
// These are the ones that catch a *new* command breaking the contract, rather
// than an existing one regressing — which is the failure mode a hand-written
// per-command test suite always misses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from 'commander';
import { main } from '../index.ts';
import { Printer } from '../output.ts';
import { buildProgram } from '../program.ts';
import { Runtime } from '../runtime.ts';

function program(): Command {
  const printer = new Printer({
    json: false,
    color: false,
    stdout: () => {},
    stderr: () => {},
  });
  const rt = new Runtime({ printer, env: {}, color: false });
  return buildProgram(rt);
}

/** Every runnable leaf, as ["graph ls", command] pairs. */
function leaves(command: Command, prefix = ''): Array<[string, Command]> {
  return command.commands
    .filter((child) => child.name() !== 'help')
    .flatMap((child) => {
      const name = prefix ? `${prefix} ${child.name()}` : child.name();
      return child.commands.length
        ? leaves(child, name)
        : ([[name, child]] as Array<[string, Command]>);
    });
}

const everyLeaf = leaves(program());
const byName = new Map(everyLeaf);

const GLOBAL_FLAGS = ['--json', '--url', '--workspace', '--no-color'];

/** The leaves that list records, which must all share the same contract. */
const LIST_COMMANDS = [
  'workspace members',
  'graph ls',
  'graph forks',
  'graph importers',
  'node ls',
  'import ls',
  'override ls',
  'version ls',
  'portkind ls',
];

/** The writes that can change what a graph resolves to. */
const CHECKABLE_COMMANDS = [
  'node add',
  'node set',
  'node rm',
  'import add',
  'import set',
  'import pin',
  'import rm',
  'override add',
  'override rm',
];

function has(command: Command, flag: string): boolean {
  return command.options.some((option) => option.long === flag);
}

describe('command tree', () => {
  it('is not empty', () => {
    expect(everyLeaf.length).toBeGreaterThan(30);
  });

  it.each(everyLeaf)('%s documents itself', (_name, command) => {
    expect(command.summary().trim()).not.toBe('');
    expect(command.description().trim()).not.toBe('');
  });

  // The whole agent contract is that --json works everywhere. The subclass in
  // program.ts adds the global flags to every subcommand it creates; this is
  // the regression net under that.
  it.each(everyLeaf)('%s carries the global flags', (_name, command) => {
    for (const flag of GLOBAL_FLAGS) {
      expect(has(command, flag), `${flag} missing`).toBe(true);
    }
  });

  // Flags without help text are how a CLI stops being self-documenting.
  it.each(everyLeaf)('%s describes each of its flags', (_name, command) => {
    for (const option of command.options) {
      expect(option.description.trim(), `${option.flags}`).not.toBe('');
    }
  });

  it('gives every list command the whole standard contract', () => {
    for (const name of LIST_COMMANDS) {
      const command = byName.get(name);
      expect(command, name).toBeDefined();
      for (const flag of [
        '--filter',
        '--sort',
        '--page',
        '--per-page',
        '--all',
      ]) {
        expect(has(command!, flag), `${name} ${flag}`).toBe(true);
      }
    }
  });

  it('keeps the list contract exactly where it is declared', () => {
    const listing = everyLeaf
      .filter(([, command]) => has(command, '--filter'))
      .map(([name]) => name)
      .sort();
    expect(listing).toEqual([...LIST_COMMANDS].sort());
  });

  it('lets every deletion skip its confirmation with --yes', () => {
    const deletions = everyLeaf
      .map(([name]) => name)
      .filter((name) => name.endsWith(' rm') && name !== 'graph rm');
    expect(deletions.length).toBeGreaterThan(0);
    for (const name of deletions) {
      expect(has(byName.get(name)!, '--yes'), name).toBe(true);
    }
    // graph rm has --yes too, alongside its stronger --force.
    expect(has(byName.get('graph rm')!, '--yes')).toBe(true);
    expect(has(byName.get('graph rm')!, '--force')).toBe(true);
  });

  it('offers --check on every write that changes resolution', () => {
    for (const name of CHECKABLE_COMMANDS) {
      const command = byName.get(name);
      expect(command, name).toBeDefined();
      expect(has(command!, '--check'), name).toBe(true);
    }
  });
});

describe('exit codes', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 0 for --version', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(stdout.join('')).toContain('0.0.0');
  });

  it('exits 0 for --help', async () => {
    expect(await main(['graph', 'ls', '--help'])).toBe(0);
    expect(stdout.join('')).toContain('--filter');
  });

  it('exits 2 with a suggestion for an unknown command', async () => {
    expect(await main(['grph'])).toBe(2);
    expect(stderr.join('')).toContain('graph');
  });

  it('exits 2 for an unknown flag', async () => {
    expect(await main(['graph', 'ls', '--bogus'])).toBe(2);
  });

  it('exits 2 for a bare invocation', async () => {
    expect(await main([])).toBe(2);
  });

  // An agent that typos a flag must be able to tell "I asked wrong" from "the
  // server said no" without parsing prose — and stderr must stay one JSON
  // object while it does.
  it('keeps the JSON error envelope on usage failures', async () => {
    expect(await main(['--json', 'graph', 'ls', '--bogus'])).toBe(2);
    expect(stdout.join('')).toBe('');
    const envelope = JSON.parse(stderr.join(''));
    expect(envelope.ok).toBe(false);
    expect(envelope.error.type).toBe('usage');
    expect(envelope.error.message).toContain('--bogus');
  });
});
