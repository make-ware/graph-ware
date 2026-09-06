# @project/cli — `graphware`

Drives the graph-ware builder from a terminal or an agent. It talks to
PocketBase **as an ordinary user**, through the same collection rules the
webapp obeys — which is what makes it both a usable client and a live check
that those rules say what they are meant to.

```bash
yarn cli login --email you@example.com
yarn cli workspace use my-team
yarn cli graph ls
yarn cli resolve LightSwitch
```

Or directly: `./cli/bin/graphware.js graph ls`. For a machine-wide `graphware`,
`npm link` from this directory — the bin resolves `tsx` and `@project/shared`
through the checkout, so it works as long as the repo stays put.

Parsing and help are [commander]; interactive prompts are [@inquirer/prompts].
`graphware --help` is the index, `graphware <noun> --help` lists the verbs, and
every leaf documents its flags, with worked examples on the ones that take
JSON. Prompts fill in what you left off — `login` asks for credentials,
`workspace use` with no argument offers a menu, `graph new` asks for the
required fields — but **only on a TTY**; headless invocations fail fast with
the flag to pass instead.

[commander]: https://www.npmjs.com/package/commander
[@inquirer/prompts]: https://www.npmjs.com/package/@inquirer/prompts

## No build step in development

`bin/graphware.js` registers tsx's ESM loader and imports `src/index.ts`, so
what runs is the source. `tsx` is therefore a real dependency, not a devDep,
and `yarn cli`, `npm link` and the tests all go through it — nothing has to be
built to work on this package.

The two tsup configs exist only to produce artifacts:

| Command  | Config                  | Output                | For                                     |
| -------- | ----------------------- | --------------------- | --------------------------------------- |
| `build`  | `tsup.config.ts`        | `dist/graphware.js`   | a compiled copy for use in the checkout |
| `bundle` | `tsup.bundle.config.ts` | `bundle/graphware.js` | the GitHub release asset                |

```bash
yarn workspace @project/cli build     # dist/  — npm deps stay external
yarn workspace @project/cli bundle    # bundle/ — single self-contained file
```

Both use `src/cli.ts` as the entry (`src/index.ts` only _exports_ `main`; the
tsx launcher and the tests are its callers). Both inline `@project/shared`,
because it is source-only — its exports map points at raw `.ts`, which Node
cannot load, so a dist that left it external would die on its first import.
`bundle` goes further and inlines _everything_ (`noExternal: [/.*/]`), so the
published artifact needs nothing but Node >= 20.19 on `PATH` — not even tsx.

`VERSION` in `src/program.ts` is substituted at build time from the root
`package.json` (the one release-please bumps), or from `GW_VERSION` when the
release workflow passes it explicitly. Running from source reports
`0.0.0-dev`.

## The standard listing contract

Every `ls`-style command (`graph ls`, `node ls`, `import ls`, `override ls`,
`version ls`, `portkind ls`, `graph forks`, `graph importers`,
`workspace members`) takes the same four flags:

| Flag                        | Meaning                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `-f, --filter`              | PocketBase filter expression, ANDed onto the command's own scope     |
| `-s, --sort`                | comma-separated fields, `-` prefix for descending (`-created,label`) |
| `-p, --page` / `--per-page` | server-side pagination, pages from 1, max 500 per page               |
| `--all`                     | walk every page and return one combined list                         |

`--filter` composes with — never replaces — the command's scope, so it can
narrow "nodes of this graph" but not escape it. Filter syntax is PocketBase's:
`field = "x"`, `label ~ "fuse"` (contains), combined with `&&` / `||`.

The one exception is `workspace ls`, which is a membership join rather than a
collection read and says so in its help.

## Building with diagnostics: `--check`

Every write that changes what a graph resolves to (`node add|set|rm`,
`import add|set|pin|rm`, `override add|rm`) takes `--check`: after the write,
the graph is resolved and its diagnostics are reported — appended to the JSON
payload as a `diagnostics` array, printed (or an explicit "clean") in human
mode. That closes the agent loop — append data, read what it did to the graph,
keep building — without a second invocation. `resolve` and `lint` are the
read-only versions of the same run.

## For agents

- **`--json` on every command.** Success is `{"ok": true, "data": …}` on stdout
  and nothing else; failure is `{"ok": false, "error": {type, message,
fieldErrors}}` on stderr. `.ok` is checkable without knowing which command
  produced the payload. `--json` prints the _raw_ records — the columns in
  human mode are a reading affordance, not the data. Paged listings keep their
  envelope: `data` is `{page, perPage, totalItems, totalPages, items}`, so an
  agent that got page 1 of 4 can see there are three more.
- **Exit codes.** `0` success, `1` the operation failed (including `lint`
  finding errors), `2` the command line was wrong. Unknown flags are rejected
  (with a did-you-mean suggestion), so a typo is `2` rather than being silently
  ignored.
- **Never prompts when it cannot.** Prompts require a TTY and human output
  mode; with neither, missing input is an immediate, actionable error instead
  of a hang.

### Environment

| Variable                                 | Effect                                                          |
| ---------------------------------------- | --------------------------------------------------------------- |
| `POCKETBASE_URL`                         | Server URL. Default `http://localhost:8090`. `--url` overrides. |
| `GRAPHWARE_EMAIL` / `GRAPHWARE_PASSWORD` | Sign in automatically when no valid token is stored.            |
| `GRAPHWARE_TOKEN`                        | Use this token directly, ahead of anything stored.              |
| `GRAPHWARE_WORKSPACE`                    | Active workspace (slug or id).                                  |
| `GRAPHWARE_CONFIG_DIR`                   | Where `auth.json` lives. Set it to isolate parallel agents.     |
| `GRAPHWARE_JSON=1`                       | Same as `--json`.                                               |
| `NO_COLOR`                               | Suppress ANSI (also automatic when stdout is not a terminal).   |

Deliberately **not** wired to `POCKETBASE_ADMIN_*`: those are superuser
credentials for a different endpoint, and bypassing the collection rules would
throw away the property that makes this tool worth having.

## Session state

`~/.config/graphware/auth.json`, mode `0600`, keyed by server URL — so a
session against staging and one against production can coexist and switching
never silently reuses the wrong token. The active workspace is stored beside
the token, which is the CLI's equivalent of the webapp's `localStorage` choice.

## Commands

`graphware --help` lists them; `graphware <noun> --help` lists the verbs. The
surface matches the webapp editor: `login`/`logout`/`whoami`/`register`/
`passwd`/`profile`, `workspace`, `graph`, `node`, `import`, `override`,
`version`, `resolve`, `lint`, `portkind`.

Two worth knowing about:

- **`resolve`** runs the engine and prints the flat nodes, the _derived_ edges
  and the diagnostics. No edge is stored anywhere; they are computed from port
  compatibility at read time. Nodes are addressed by instance path, so a child
  imported twice shows up as two distinct instances rather than collapsing —
  and those paths are what `override add` endpoints take.
- **`import alias`** is two writes, not one: the import, then every edge
  override whose endpoints sit under the old alias. PocketBase has no
  multi-record transaction, so a failure part-way leaves a partial rename —
  `--dry-run` shows exactly what would move, and a partial failure reports how
  far it got.

Deletions (`graph rm`, `node rm`, `import rm`, `override rm`) confirm on a TTY
and take `-y`/`--yes` to skip; `graph rm` additionally refuses while other
graphs import the target unless `--force` is passed.

## Tests

`yarn workspace @project/cli test` — all offline, no server. Alongside the
behavioural tests (handlers called with stub mutators) there is a
**structural** pass walking the commander tree, asserting every leaf documents
itself and its flags, carries the global flags, and that the listing/`--check`/
`--yes` contracts hold exactly where they are declared — plus exit-code tests
driving `main()` end to end. That is the pass that catches a _new_ command
breaking the agent contract.
