# @project/cli — `graphware`

Drives the graph-ware builder from a terminal or an agent. It talks to
PocketBase **as an ordinary user**, through the same collection rules the
webapp obeys — which is what makes it both a usable client and a live check
that those rules say what they are meant to.

```bash
yarn cli login --email you@example.com --password …
yarn cli workspace use my-team
yarn cli graph ls
yarn cli resolve LightSwitch
```

Or directly: `./cli/bin/graphware.js graph ls`. For a machine-wide `graphware`,
`npm link` from this directory — the bin resolves `tsx` and `@project/shared`
through the checkout, so it works as long as the repo stays put.

## No build step

`bin/graphware.js` registers tsx's ESM loader and imports `src/index.ts`, so
what runs is the source. `tsx` is therefore a real dependency, not a devDep.

## For agents

- **`--json` on every command.** Success is `{"ok": true, "data": …}` on stdout
  and nothing else; failure is `{"ok": false, "error": {type, message,
fieldErrors}}` on stderr. `.ok` is checkable without knowing which command
  produced the payload. `--json` prints the _raw_ records — the columns in
  human mode are a reading affordance, not the data.
- **Exit codes.** `0` success, `1` the operation failed (including `lint`
  finding errors), `2` the command line was wrong. Unknown flags are rejected,
  so a typo is `2` rather than being silently ignored.
- **Never prompts when it cannot.** With no credentials and no TTY it fails
  immediately with an actionable message instead of blocking on a prompt
  nobody can answer.

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

`graphware` with no arguments lists them; `graphware <command> --help` shows
the flags. The surface matches the webapp editor: `login`/`logout`/`whoami`/
`register`/`passwd`, `workspace`, `graph`, `node`, `import`, `override`,
`version`, `resolve`, `lint`, `portkind`.

Two worth knowing about:

- **`resolve`** runs the engine and prints the flat nodes, the _derived_ edges
  and the diagnostics. No edge is stored anywhere; they are computed from port
  compatibility at read time. Nodes are addressed by instance path, so a child
  imported twice shows up as two distinct instances rather than collapsing.
- **`import alias`** is two writes, not one: the import, then every edge
  override whose endpoints sit under the old alias. PocketBase has no
  multi-record transaction, so a failure part-way leaves a partial rename —
  `--dry-run` shows exactly what would move, and a partial failure reports how
  far it got.

## Tests

`yarn workspace @project/cli test` — all offline, no server. Alongside the
usual unit tests there is a **structural** pass over the registry asserting
every command declares a usage line and does not shadow a global flag. That is
the test that catches a _new_ command breaking the agent contract.
