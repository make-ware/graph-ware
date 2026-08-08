// The command table. One place, walked by both the dispatcher and the help
// renderer — which is what stops help from drifting away from what runs.
import * as auth from './commands/auth.ts';
import * as graph from './commands/graph.ts';
import * as importCmd from './commands/import.ts';
import * as node from './commands/node.ts';
import * as override from './commands/override.ts';
import * as portkind from './commands/portkind.ts';
import * as resolveCmd from './commands/resolve.ts';
import * as version from './commands/version.ts';
import * as workspace from './commands/workspace.ts';
import type { Registry } from './command.ts';

export const registry: Registry = {
  // Session verbs read better without a noun, so they are their own nouns with
  // a single `run` verb — see `isBareNoun` below.
  login: { summary: auth.login.summary, commands: { run: auth.login } },
  logout: { summary: auth.logout.summary, commands: { run: auth.logout } },
  whoami: { summary: auth.whoami.summary, commands: { run: auth.whoami } },
  register: {
    summary: auth.register.summary,
    commands: { run: auth.register },
  },
  passwd: { summary: auth.passwd.summary, commands: { run: auth.passwd } },
  resolve: {
    summary: resolveCmd.resolve.summary,
    commands: { run: resolveCmd.resolve },
  },
  lint: {
    summary: resolveCmd.lint.summary,
    commands: { run: resolveCmd.lint },
  },

  profile: {
    summary: 'Your user profile',
    commands: { set: auth.profileSet },
  },
  workspace: {
    summary: 'Workspaces and their members',
    commands: {
      ls: workspace.ls,
      use: workspace.use,
      show: workspace.show,
      new: workspace.create,
      members: workspace.members,
      'add-member': workspace.addMember,
    },
  },
  graph: {
    summary: 'Graphs',
    commands: {
      ls: graph.ls,
      new: graph.create,
      show: graph.show,
      set: graph.set,
      rm: graph.rm,
      fork: graph.fork,
      forks: graph.forks,
      importers: graph.importers,
    },
  },
  node: {
    summary: 'Nodes within a graph',
    commands: {
      ls: node.ls,
      show: node.show,
      add: node.add,
      set: node.set,
      rm: node.rm,
    },
  },
  import: {
    summary: 'Composition — importing one graph into another',
    commands: {
      ls: importCmd.ls,
      add: importCmd.add,
      set: importCmd.set,
      alias: importCmd.alias,
      move: importCmd.move,
      pin: importCmd.pin,
      overrides: importCmd.overrides,
      rm: importCmd.rm,
    },
  },
  override: {
    summary: 'Edge overrides — pinning and suppressing derived edges',
    commands: {
      ls: override.ls,
      add: override.add,
      rm: override.rm,
    },
  },
  version: {
    summary: 'Published snapshots',
    commands: {
      ls: version.ls,
      show: version.show,
      publish: version.publish,
      restore: version.restore,
    },
  },
  portkind: {
    summary: 'Port kinds — what auto-connect matches on',
    commands: {
      ls: portkind.ls,
      registry: portkind.registry,
    },
  },
};

/**
 * A noun whose only verb is `run` takes no verb on the command line:
 * `graphware login`, not `graphware login run`.
 */
export function isBareNoun(name: string): boolean {
  const noun = registry[name];
  return Boolean(
    noun && Object.keys(noun.commands).length === 1 && noun.commands.run
  );
}
