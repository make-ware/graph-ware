#!/usr/bin/env node

/**
 * One-shot bootstrap for a project cloned from this template.
 *
 * Renames the workspace scope, retitles the app, optionally strips the example
 * Todos feature, writes .env, and regenerates README.md / CLAUDE.md so they
 * describe the new project instead of the template.
 *
 * Usage:
 *   yarn init:project                       # interactive
 *   yarn init:project --yes                 # accept defaults (name from dir)
 *   yarn init:project --name acme-app --scope @acme --no-example
 *   yarn init:project --dry-run             # show what would change
 *
 * Node builtins only — this runs before `yarn install` if you want it to.
 */

const fs = require('fs');
const path = require('path');
const readline = require('node:readline/promises');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(__dirname, 'templates');

// What we are renaming away from. The template ships two historical names:
// the workspace scope/root package (`template-ware`) and the release-please /
// Docker package name (`starter-ware`).
const OLD_SCOPE = '@template-ware';
const OLD_ROOT_NAME = 'template-ware';
const OLD_ALT_NAME = 'starter-ware';

// Directories never walked when doing text replacement.
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.yarn',
  '.next',
  'out',
  'dist',
  'build',
  'coverage',
  'pb_data',
  'data',
]);

// Files removed/edited when the example Todos feature is dropped.
const EXAMPLE_PATHS = [
  'webapp/src/app/todos',
  'webapp/src/components/todos',
  'webapp/src/contexts/todo-context.tsx',
  'webapp/src/hooks/use-todo.ts',
  'webapp/src/hooks/use-todo-subscription.ts',
  'webapp/src/mutators/todo.ts',
  'webapp/src/schema/todo.ts',
];

// Migrations are timestamp-prefixed, so match on the collection instead of a
// fixed filename — a regenerated migration must not survive the removal.
const EXAMPLE_MIGRATION_RE = /_created_Todos\.js$/;

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    name: null,
    scope: null,
    title: null,
    description: null,
    example: null, // null = ask
    resetGit: false,
    keepDocs: false,
    cleanup: false,
    dryRun: false,
    yes: false,
    force: false,
  };

  const takesValue = new Set(['--name', '--scope', '--title', '--description']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (takesValue.has(arg)) {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      opts[arg.replace(/^--/, '').replace(/-(\w)/g, (_, ch) => ch.toUpperCase())] = value;
      continue;
    }
    switch (arg) {
      case '--example':
        opts.example = true;
        break;
      case '--no-example':
        opts.example = false;
        break;
      case '--reset-git':
        opts.resetGit = true;
        break;
      case '--keep-docs':
        opts.keepDocs = true;
        break;
      case '--cleanup':
        opts.cleanup = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '-y':
      case '--yes':
        opts.yes = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        fail(`Unknown option: ${arg}\nRun with --help to see the available flags.`);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
${c.bold('init-project')} — turn this template clone into your own project.

  yarn init:project [options]

Options:
  --name <kebab-case>     Project / repo name        (default: this directory's name)
  --scope <@scope>        Workspace scope            (default: @<name>)
  --title "My App"        Display name in the UI     (default: title-cased name)
  --description "..."     One-line app description
  --example               Keep the example Todos feature
  --no-example            Remove the example Todos feature
  --keep-docs             Don't regenerate README.md / CLAUDE.md
  --cleanup               Delete the init tooling when finished
  --reset-git             Wipe git history and start a fresh initial commit
  --dry-run               Print the plan without touching anything
  -y, --yes               Skip prompts, accept defaults
  --force                 Proceed despite a dirty tree / already-initialized repo
  -h, --help              Show this message
`);
}

function fail(message) {
  console.error(`${c.red('Error:')} ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validation and derivation
// ---------------------------------------------------------------------------

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const SCOPE_RE = /^@[a-z0-9][a-z0-9._-]*$/;

function validateName(name) {
  if (!NAME_RE.test(name)) {
    return 'must be lowercase kebab-case (letters, digits, dashes) and start with a letter or digit';
  }
  if (name === OLD_ROOT_NAME || name === OLD_ALT_NAME) {
    return `"${name}" is the template's own name — pick a different one`;
  }
  return null;
}

function validateScope(scope) {
  if (!SCOPE_RE.test(scope)) return 'must look like @my-scope (lowercase, leading @)';
  if (scope === OLD_SCOPE) return `"${scope}" is the template's own scope — pick a different one`;
  return null;
}

function titleFromName(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/** Collect every text file under ROOT, skipping build output and binaries. */
function collectTextFiles(dir = ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectTextFiles(full, acc);
    } else if (entry.isFile()) {
      if (isTextFile(full)) acc.push(full);
    }
  }
  return acc;
}

function isTextFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  // The PocketBase binary and any stray archives are large; skip on size first.
  if (stat.size > 5 * 1024 * 1024 || stat.size === 0) return false;

  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(8192, stat.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return !buf.includes(0); // NUL byte => binary
  } finally {
    fs.closeSync(fd);
  }
}

/** Tracks every write so --dry-run can report without mutating. */
class Changes {
  constructor(dryRun) {
    this.dryRun = dryRun;
    this.written = new Set();
    this.deleted = [];
    this.notes = [];
  }

  write(file, contents) {
    const rel = path.relative(ROOT, file);
    this.written.add(rel);
    if (!this.dryRun) fs.writeFileSync(file, contents);
  }

  remove(target) {
    const rel = path.relative(ROOT, target);
    if (!fs.existsSync(target)) return false;
    this.deleted.push(rel);
    if (!this.dryRun) fs.rmSync(target, { recursive: true, force: true });
    return true;
  }

  note(message) {
    this.notes.push(message);
  }
}

function readFile(file) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Apply substring replacements to a file. Returns false (and records a note)
 * when an expected fragment is missing, so drift in the template surfaces
 * loudly instead of silently doing nothing.
 */
function editFile(changes, relPath, edits) {
  const file = path.join(ROOT, relPath);
  if (!fs.existsSync(file)) {
    changes.note(`skipped ${relPath} (not found)`);
    return false;
  }
  let contents = readFile(file);
  let touched = false;

  for (const [from, to] of edits) {
    if (!contents.includes(from)) {
      changes.note(`${relPath}: expected fragment not found — ${truncate(from)}`);
      continue;
    }
    contents = contents.split(from).join(to);
    touched = true;
  }

  if (touched) changes.write(file, contents);
  return touched;
}

/** Drop whole lines containing any of the given substrings. */
function dropLines(changes, relPath, needles) {
  const file = path.join(ROOT, relPath);
  if (!fs.existsSync(file)) {
    changes.note(`skipped ${relPath} (not found)`);
    return;
  }
  const lines = readFile(file).split('\n');
  const kept = lines.filter((line) => !needles.some((needle) => line.includes(needle)));
  if (kept.length !== lines.length) changes.write(file, kept.join('\n'));
  else changes.note(`${relPath}: no matching lines to drop`);
}

function truncate(str, max = 60) {
  const flat = str.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Escape for embedding inside a single-quoted TS/JS string literal. */
function tsString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Escape for embedding as JSX text. */
function jsxText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function renameEverywhere(changes, config) {
  const files = collectTextFiles();
  let count = 0;

  for (const file of files) {
    // The doc templates use placeholders, not the old names — and this script
    // holds the old names as constants, so renaming inside it would corrupt it.
    if (file.startsWith(TEMPLATES + path.sep) || file === __filename) continue;

    const original = readFile(file);
    let updated = original
      .split(`${OLD_SCOPE}/`)
      .join(`${config.scope}/`)
      .split(OLD_ALT_NAME)
      .join(config.name);

    // Whatever is left of the bare root name (root package.json, LICENSE).
    updated = updated.split(OLD_ROOT_NAME).join(config.name);

    if (updated !== original) {
      changes.write(file, updated);
      count++;
    }
  }

  return count;
}

/**
 * Renaming the workspaces moves their yarn.lock entries out of sort order,
 * which makes `yarn install --immutable` (used by the Docker builds) refuse the
 * lockfile. Yarn keeps entries sorted by descriptor with `__metadata` pinned
 * first, so re-sort the blocks in place rather than leaving that to an install.
 */
function sortYarnLock(changes) {
  const file = path.join(ROOT, 'yarn.lock');
  if (!fs.existsSync(file)) return;

  const contents = readFile(file);
  const trailingNewline = contents.endsWith('\n');
  const blocks = contents.replace(/\n+$/, '').split('\n\n');

  // Leading comment banner, then __metadata, then the entries.
  const header = [];
  const entries = [];
  for (const block of blocks) {
    const firstLine = block.split('\n')[0];
    if (firstLine.startsWith('#') || firstLine.startsWith('__metadata:')) header.push(block);
    else entries.push(block);
  }

  const keyOf = (block) => {
    const firstLine = block.split('\n')[0].replace(/:\s*$/, '');
    return firstLine.startsWith('"') && firstLine.endsWith('"')
      ? firstLine.slice(1, -1)
      : firstLine;
  };

  entries.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const sorted = [...header, ...entries].join('\n\n') + (trailingNewline ? '\n' : '');
  if (sorted !== contents) changes.write(file, sorted);
}

function retitleApp(changes, config) {
  editFile(changes, 'webapp/src/app/layout.tsx', [
    [
      "title: 'Next.js + PocketBase Template',",
      `title: '${tsString(config.title)}',`,
    ],
    [
      "description: 'A modern full-stack template with authentication',",
      `description: '${tsString(config.description)}',`,
    ],
  ]);

  editFile(changes, 'webapp/src/components/layout/navigation-bar.tsx', [
    [
      '<span className="font-bold text-xl">App</span>',
      `<span className="font-bold text-xl">${jsxText(config.title)}</span>`,
    ],
  ]);
}

function removeExample(changes) {
  for (const rel of EXAMPLE_PATHS) {
    if (!changes.remove(path.join(ROOT, rel))) changes.note(`${rel} was already gone`);
  }

  const migrationsDir = path.join(ROOT, 'pocketbase', 'pb_migrations');
  const migrations = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((file) => EXAMPLE_MIGRATION_RE.test(file))
    : [];
  if (migrations.length === 0) {
    changes.note('no Todos migration found in pocketbase/pb_migrations');
  }
  for (const file of migrations) {
    changes.remove(path.join(migrationsDir, file));
  }

  dropLines(changes, 'webapp/src/schema/index.ts', ["from './todo'"]);
  dropLines(changes, 'webapp/src/mutators/index.ts', ["from './todo'"]);

  dropLines(changes, 'webapp/src/types/index.ts', [
    "from '../schema/todo'",
    "collection(idOrName: 'Todos')",
  ]);
  dropLines(changes, 'webapp/src/lib/types.ts', [
    "from '@/schema/todo'",
    "collection(idOrName: 'Todos' | 'todos')",
  ]);

  editFile(changes, 'webapp/src/components/layout/navigation-bar.tsx', [
    [
      "import { Menu, LogOut, Settings, CheckSquare } from 'lucide-react';",
      "import { Menu, LogOut, Settings } from 'lucide-react';",
    ],
    ["    { href: '/todos', label: 'Todos', icon: CheckSquare },\n", ''],
  ]);
}

function installTemplate(changes, config, templateName, destRel) {
  const src = path.join(TEMPLATES, templateName);
  if (!fs.existsSync(src)) {
    changes.note(`template ${templateName} missing — left ${destRel} untouched`);
    return;
  }
  changes.write(path.join(ROOT, destRel), render(readFile(src), config));
}

/** Fill placeholders and resolve the EXAMPLE conditional blocks. */
function render(source, config) {
  let out = source;

  if (config.example) {
    out = out.replace(/<!-- IF_EXAMPLE -->\n?/g, '').replace(/<!-- END_IF_EXAMPLE -->\n?/g, '');
    out = out.replace(/<!-- IF_NO_EXAMPLE -->[\s\S]*?<!-- END_IF_NO_EXAMPLE -->\n?/g, '');
  } else {
    out = out.replace(/<!-- IF_EXAMPLE -->[\s\S]*?<!-- END_IF_EXAMPLE -->\n?/g, '');
    out = out
      .replace(/<!-- IF_NO_EXAMPLE -->\n?/g, '')
      .replace(/<!-- END_IF_NO_EXAMPLE -->\n?/g, '');
  }

  return out
    .split('{{PROJECT_NAME}}')
    .join(config.name)
    .split('{{PROJECT_TITLE}}')
    .join(config.title)
    .split('{{PROJECT_DESCRIPTION}}')
    .join(config.description)
    .split('{{SCOPE}}')
    .join(config.scope);
}

function writeEnv(changes) {
  const envPath = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');
  if (fs.existsSync(envPath)) {
    changes.note('.env already exists — left as is');
    return;
  }
  if (!fs.existsSync(examplePath)) return;
  changes.write(envPath, readFile(examplePath));
}

function cleanupInitTooling(changes) {
  changes.remove(TEMPLATES);
  changes.remove(path.join(__dirname, 'init-project.js'));

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(readFile(pkgPath));
  if (pkg.scripts && pkg.scripts['init:project']) {
    delete pkg.scripts['init:project'];
    changes.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

function resetGit(changes, config) {
  if (changes.dryRun) {
    changes.note('would delete .git and create a fresh initial commit');
    return;
  }
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: 'pipe' });
  fs.rmSync(path.join(ROOT, '.git'), { recursive: true, force: true });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `chore: initialize ${config.name}`);
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

function isDirty() {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim().length > 0;
  } catch {
    return false; // not a git repo — nothing to protect
  }
}

function alreadyInitialized() {
  const pkg = JSON.parse(readFile(path.join(ROOT, 'package.json')));
  return pkg.name !== OLD_ROOT_NAME;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const interactive = !opts.yes && process.stdin.isTTY && process.stdout.isTTY;

  if (alreadyInitialized() && !opts.force) {
    const pkg = JSON.parse(readFile(path.join(ROOT, 'package.json')));
    fail(
      `this repo looks initialized already (root package is "${pkg.name}").\n` +
        '       Re-run with --force if you really want to rename it again.'
    );
  }

  if (!opts.dryRun && isDirty() && !opts.force) {
    fail(
      'the working tree has uncommitted changes.\n' +
        '       Commit or stash them first (this script rewrites files in place),\n' +
        '       or re-run with --dry-run to preview, or --force to proceed anyway.'
    );
  }

  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;

  const ask = async (question, fallback) => {
    if (!rl) return fallback;
    const answer = (await rl.question(`${question} ${c.dim(`[${fallback}]`)} `)).trim();
    return answer || fallback;
  };

  const askYesNo = async (question, fallback) => {
    if (!rl) return fallback;
    const hint = fallback ? 'Y/n' : 'y/N';
    const answer = (await rl.question(`${question} ${c.dim(`[${hint}]`)} `)).trim().toLowerCase();
    if (!answer) return fallback;
    return answer.startsWith('y');
  };

  try {
    if (interactive) {
      console.log(`\n${c.bold('Initializing a project from the Next.js + PocketBase template')}\n`);
    }

    // Name
    let name = opts.name || (await ask('Project name (kebab-case):', path.basename(ROOT)));
    for (;;) {
      const problem = validateName(name);
      if (!problem) break;
      if (!rl) fail(`--name ${problem}`);
      console.log(`  ${c.red('✗')} Project name ${problem}`);
      name = (await rl.question('Project name (kebab-case): ')).trim();
    }

    // Scope
    let scope = opts.scope || (await ask('Workspace scope:', `@${name}`));
    for (;;) {
      const problem = validateScope(scope);
      if (!problem) break;
      if (!rl) fail(`--scope ${problem}`);
      console.log(`  ${c.red('✗')} Scope ${problem}`);
      scope = (await rl.question('Workspace scope: ')).trim();
    }

    const title = opts.title || (await ask('Display name:', titleFromName(name)));
    const description =
      opts.description ||
      (await ask('Description:', `${title} — built with Next.js and PocketBase`));

    const example =
      opts.example !== null
        ? opts.example
        : !(await askYesNo('Remove the example Todos app?', true));

    const resetGitHistory =
      opts.resetGit || (rl ? await askYesNo('Reset git history (fresh initial commit)?', false) : false);

    const config = { name, scope, title, description, example };

    // ---- plan ----
    console.log(`\n${c.bold('Plan')}`);
    console.log(`  root package      ${c.cyan(name)}`);
    console.log(`  workspaces        ${c.cyan(`${scope}/webapp`)}, ${c.cyan(`${scope}/pb`)}`);
    console.log(`  path alias        ${c.cyan(`${scope}/shared`)}`);
    console.log(`  display name      ${c.cyan(title)}`);
    console.log(`  description       ${c.cyan(description)}`);
    console.log(`  example Todos     ${example ? c.cyan('keep') : c.yellow('remove')}`);
    console.log(`  README/CLAUDE.md  ${opts.keepDocs ? c.cyan('keep') : c.yellow('regenerate')}`);
    console.log(`  git history       ${resetGitHistory ? c.yellow('reset') : c.cyan('keep')}`);
    console.log(`  init tooling      ${opts.cleanup ? c.yellow('delete') : c.cyan('keep')}`);
    if (opts.dryRun) console.log(`\n  ${c.yellow('dry run — nothing will be written')}`);
    console.log('');

    if (rl && !opts.dryRun) {
      const go = await askYesNo('Apply these changes?', true);
      if (!go) {
        console.log('Aborted.');
        return;
      }
      console.log('');
    }

    // ---- apply ----
    const changes = new Changes(opts.dryRun);

    const renamed = renameEverywhere(changes, config);
    sortYarnLock(changes);
    console.log(`${c.green('✓')} renamed ${OLD_SCOPE} → ${scope} in ${renamed} file(s)`);

    retitleApp(changes, config);
    console.log(`${c.green('✓')} retitled the app to "${title}"`);

    if (!example) {
      removeExample(changes);
      console.log(`${c.green('✓')} removed the example Todos feature`);
      // The landing page interpolates these into JSX text, so escape first.
      installTemplate(
        changes,
        { ...config, title: jsxText(config.title), description: jsxText(config.description) },
        'home-page.tsx',
        'webapp/src/app/page.tsx'
      );
      // The landing-page test asserts on the copy it renders, so it travels
      // with the page it covers.
      installTemplate(
        changes,
        config,
        'personalized-content.test.tsx',
        'webapp/src/test/__tests__/personalized-content.test.tsx'
      );
      console.log(`${c.green('✓')} replaced the landing page (and its test) with a starter page`);
    }

    if (!opts.keepDocs) {
      installTemplate(changes, config, 'README.md', 'README.md');
      installTemplate(changes, config, 'CLAUDE.md', 'CLAUDE.md');
      console.log(`${c.green('✓')} regenerated README.md and CLAUDE.md`);
    }

    writeEnv(changes);
    console.log(`${c.green('✓')} .env ready`);

    if (opts.cleanup) {
      cleanupInitTooling(changes);
      console.log(`${c.green('✓')} removed the init tooling`);
    }

    if (resetGitHistory) {
      resetGit(changes, config);
      console.log(`${c.green('✓')} git history reset`);
    }

    // ---- report ----
    if (opts.dryRun) {
      console.log(`\n${c.bold('Files that would change')} (${changes.written.size})`);
      for (const rel of [...changes.written].sort()) console.log(`  ${rel}`);
      if (changes.deleted.length) {
        console.log(`\n${c.bold('Files that would be deleted')} (${changes.deleted.length})`);
        for (const rel of changes.deleted.sort()) console.log(`  ${rel}`);
      }
    }

    if (changes.notes.length) {
      console.log(`\n${c.yellow('Notes')}`);
      for (const note of changes.notes) console.log(`  • ${note}`);
    }

    if (!opts.dryRun) {
      console.log(`\n${c.bold('Next steps')}`);
      console.log('  corepack enable');
      console.log('  yarn install          # relinks the renamed workspaces');
      console.log('  yarn setup            # download the PocketBase binary');
      console.log('  yarn dev              # Next.js :3000 + PocketBase :8090');
      console.log(`\n  ${c.dim('Then update LICENSE, and yarn precommit to verify.')}`);
    }
    console.log('');
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  console.error(`${c.red('Failed:')} ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
