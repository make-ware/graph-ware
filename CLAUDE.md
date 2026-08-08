# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Yarn 4 workspaces monorepo — run everything from the repo root. Workspaces: `@project/shared` (the domain layer), `@project/webapp` (Next.js), `@project/cli` (`graphware`), `@project/pb` (PocketBase).

```bash
yarn install
yarn setup            # download the PocketBase binary (gitignored; required before `yarn dev`)
yarn dev              # Next.js :3000 + PocketBase :8090 concurrently
yarn test             # vitest run across every workspace
yarn typecheck        # tsc --noEmit per workspace
yarn lint             # eslint --fix   (yarn lint:check for no-fix)
yarn format           # prettier --write
yarn precommit        # lint + typecheck + format + test — the actual gate
yarn cli <command>    # run the graphware CLI (see cli/README.md)
```

Only `shared` and `webapp` have real `build`/`typecheck`/`test` scripts; `cli` has no build, and `pb`'s are `echo` no-ops so `yarn workspaces foreach -A` never breaks. A new workspace has to follow that pattern.

Single test file / single test name:

```bash
yarn workspace @project/webapp test src/test/__tests__/login-form.test.tsx
yarn workspace @project/webapp test -t "shows validation error"
yarn workspace @project/webapp test:watch
```

Schema/migration scripts (see "Schema definitions vs. migrations" below). Deliberately **not** part of `precommit` — run them when you touch a schema:

```bash
yarn db:status      # diff zod schemas against the committed migrations
yarn db:verify      # which migrations the local DB actually applied (needs pb_data/data.db)
yarn db:generate    # write a migration for the pending changes
yarn db:lint        # catch JS that Node accepts but PocketBase's goja runtime rejects
yarn db:seed        # load example/data into a *running* PocketBase (needs admin creds)
yarn db:verify-rules # walk the access-rule matrix against a *running* PocketBase
yarn typegen        # generate shared/src/types/pocketbase-types.ts from the schemas
```

`db:verify-rules` signs up three users into two workspaces and asserts the whole
read/write matrix through the ordinary API, with no superuser credentials. It
exists because the access rules are strings evaluated by PocketBase's filter
engine, not code this repo runs — in particular, whether
`members.user ?= me && members.role ?!= "viewer"` is satisfied by *one* roll row
or by two different ones is the difference between a role model and every viewer
having write access, and nothing but a real server can answer it. Run it after
touching anything in `shared/src/schema/`.

The `db:*` scripts preload tsx via `NODE_OPTIONS="--import tsx"`. Without it the migrate CLI dies on Node 22 with `Cannot require() ES Module … in a cycle`. Don't strip it.

CI (`.github/workflows/release.yml`) only runs release-please and Docker image builds — it does **not** run lint, typecheck, or tests. `yarn precommit` is the only place those run.

PocketBase alone: `yarn workspace @project/pb dev` (`./pocketbase serve`). Admin UI at <http://localhost:8090/_/>; first visit creates the superuser.

## The domain

Graph-ware is a flowchart/schematic builder for hardware-like systems. Components declare typed ports; **the wiring between them is derived from port compatibility, not stored**. Design rationale in `docs/DESIGN.md`, collection reference in `docs/DATA_MODEL.md`, reuse semantics in `docs/IMPORTS.md`, the engine contract in `docs/GRAPH_ENGINE.md`, and the phased roadmap in `docs/phases/`.

Eight domain collections: `Workspaces`, `WorkspaceMembers`, `Graphs`,
`GraphNodes`, `GraphImports`, `GraphEdgeOverrides`, `GraphVersions`,
`PortKinds`.

Five rules that everything else follows from:

**Edges are not stored.** Connections are computed at render time by matching an output port to inputs of the same `kind`, honouring `one`/`many` relationship budgets and evaluating input-port attribute filters against the *source node's* attributes. The only persisted edge data is `GraphEdgeOverrides`, which patches that result (`pin` / `suppress`) rather than replacing it. Don't add an edge collection; extend port kinds and filters instead.

**Graphs compose by reference, and a child can be imported twice.** `GraphImports` is a join collection with a per-parent unique `alias`. Two rows may name the same child — that is the point, and it is what the old `childGraphs: string[]` model could not do.

**Instance paths, not record ids, identify anything derived.** Because a child can appear twice, one `GraphNodes` record can appear twice in a resolved tree. Flat nodes, edges, diagnostics, layout positions, canvas selection and `GraphEdgeOverrides` endpoints are all keyed by `buildInstanceId(instancePath, nodeId)` — the chain of import aliases plus the node id (`shared/src/lib/graph/imports.ts`). Reaching for a record id in the derived layer looks correct until something is imported twice, then two components silently collapse into one.

**Hybrid normalization.** Graphs and nodes are records — they need rules, realtime, atomic writes. Ports and attributes are validated JSON *on the node*; they have no independent identity and nothing references them. To change their shape, edit `shared/src/lib/graph/primitives.ts`, not the schema directory. A `GraphVersions` snapshot is JSON for the same reason plus one more: it is written once, read whole, and never queried field by field.

**A workspace owns a graph; a user created it.** Since Phase 5 every access decision goes through `Graphs.workspace` and its `WorkspaceMembers` roll. `Graphs.owner` survives as provenance and grants nothing. Every user gets a personal workspace on signup — provisioned by `pocketbase/pb_hooks/workspaces.pb.js`, because a client that forgets to create one leaves an account that cannot create anything at all. In the UI, `canEdit` (a non-viewer member of the graph's workspace) is what gates every write control; `isOwner` still exists and decides nothing.

`shared/src/lib/graph/primitives.ts` must **stay out of `shared/src/schema/`**: `pocketbase-migrate` imports every file in that directory looking for a `defineCollection` export, and `schema.exclude` has to stay at its default.

Schema files import primitives with a **relative** path (`../lib/graph/primitives`) — never `@/…`, and never `@project/shared`. The migrate CLI loads them through tsx from the repo root, where neither the webapp's path alias nor the package's own exports map is in scope. Everything else under `shared/src/` follows the same rule, which is why moving the whole tree out of `webapp/src` required no import edits at all.

## Architecture

Next.js frontend + PocketBase backend. **All data access is client-side**: the browser talks to PocketBase directly via the JS SDK. There are no route handlers, no server actions, and no server-side PocketBase client — every page under `webapp/src/app/` is `'use client'`. `docs/PB_SSR.md` explains why (a module-scoped `pb` instance would leak auth state across server requests) — keep new data access on the client.

Data flows in layers, top to bottom:

| Layer | Location | Role |
|---|---|---|
| Schema | `shared/src/schema/*.ts` | zod + `pocketbase-zod-schema` `defineCollection` — field validation **and** PocketBase access rules |
| Value objects | `shared/src/lib/graph/primitives.ts` | attributes, ports, filters — the JSON stored on a node |
| Mutators | `shared/src/mutators/*.ts` | `BaseMutator` subclasses: typed CRUD, filter/sort/expand defaults, realtime subscribe |
| Services | `shared/src/services/auth.ts` | high-level auth ops over the user mutator + `pb.authStore` |
| Contexts | `webapp/src/contexts/*.tsx` | React state, optimistic updates, subscription lifecycle |
| Components | `webapp/src/components/` | shadcn/ui primitives in `ui/`, feature components alongside |

`shared/src/lib/graph/resolver.ts`, `clone.ts` and `engine.ts` sit between mutators and components: the resolver loads an import tree (resolving pinned imports from their snapshots), `clone.ts` forks one, and the engine turns a resolved tree into flat nodes, edges, diagnostics and positions. The engine must stay pure — no DOM, no network — which is what makes it testable. `resolver.ts` and `clone.ts` take a PocketBase client and are therefore kept out of the `@project/shared` barrel; `snapshot.ts` is pure and is in it, which is why the two networked snapshot operations (`publish`, `restore`) live on `GraphVersionMutator` instead.

### `@project/shared` is a source-only workspace

It is a real package in `shared/`, resolved through the `exports` map in `shared/package.json` — **no tsconfig alias**. It was an alias into `webapp/src` until the CLI needed the same code; adding an alias back would shadow the package and silently produce two copies of the schema types, which breaks `instanceof` in ways that look like data bugs.

There is **no build step**. The exports map points at raw `.ts`, and each consumer compiles it: the webapp via `transpilePackages: ['@project/shared']` in `next.config.ts`, the CLI via the tsx loader its bin registers, and `pocketbase-migrate` via `NODE_OPTIONS="--import tsx"`. A `dist/` would add build ordering to `yarn dev`, both Dockerfiles and every typecheck, and a stale one is a real failure mode.

| Specifier | Contents |
|---|---|
| `@project/shared` | schemas, graph primitives, import helpers, engine, snapshot, layout, `errors`/`retry`/`loading-manager` |
| `@project/shared/schema` | the collection definitions alone |
| `@project/shared/mutators` | the `BaseMutator` subclasses |
| `@project/shared/graph` | `resolver` + `clone` — the two operations that take a PocketBase client |
| `@project/shared/types` | `TypedPocketBase` and the response/utility types |
| `@project/shared/client` | `createPocketBaseClient(url, options)` |
| `@project/shared/services` | `AuthService` / `createAuthService` |
| `@project/shared/test-fixtures` | mock PocketBase + sample graphs, for consumers' tests |

Three rules for anything inside `shared/`:

- **Never import `@project/shared` from within it.** Self-referencing would break `pocketbase-migrate`, which loads `shared/src/schema/*.ts` through tsx from the repo root, where the resolution root is the repo and not the package. Everything inside is relative — which is also why the move out of `webapp/src` needed no import edits.
- **Stay headless.** `shared/tsconfig.json` has no `DOM` lib, deliberately. No `react`, no `next`, no `'use client'`, no `process.env.NEXT_PUBLIC_*` — the webapp owns the env var and the client singleton, this package owns the factory. The one place that wants Web Storage (`services/auth.ts`'s logout sweep) reaches through `globalThis` and a local interface instead.
- **Keep `zod` and `pocketbase` versions byte-identical across `shared`, `webapp` and `cli`.** Two copies break cross-boundary `instanceof`: a second `ClientResponseError` class would make `parseAuthError` degrade every PocketBase error to a generic message.

### `@project/cli` — `graphware`

`cli/` is a Node CLI that logs into PocketBase with email and password and drives the same surface the editor does. It goes through the ordinary collection rules — no superuser path, deliberately — so it doubles as a live check that those rules say what they mean. Full notes in `cli/README.md`; the load-bearing bits:

- **No build step either.** `cli/bin/graphware.js` registers tsx's ESM loader and imports `src/index.ts`, so `tsx` is a runtime **dependency**, not a devDep. Relative imports carry their `.ts` extension (`allowImportingTsExtensions`), because Node's ESM resolver does not guess.
- **Parsing and help are commander; prompts are @inquirer/prompts.** The tree is assembled in `cli/src/program.ts`, whose `Command` subclass adds the global flags (`--json`, `--url`, `-w`, `--no-color`) to every subcommand it creates — so `--json` works at the end of any invocation without per-command wiring. Root settings (`exitOverride`, output routing) are configured *before* the registrars run, because `.command()` copies them at creation time. Prompts only fire when `canPrompt(ctx)` — a TTY and not `--json`; headless invocations fail fast instead of hanging.
- **Every `ls`-style command shares one listing contract** — `--filter`/`--sort`/`--page`/`--per-page`/`--all`, composed in `cli/src/listing.ts` by AND-joining the user filter onto the command's scope filter through `BaseMutator.getList`, so `--filter` can narrow a scope but never escape it. Writes that change resolution take `--check`, which re-resolves the graph and reports diagnostics (`cli/src/render.ts`).
- **Exit codes: 0 / 1 / 2** (ok / failed / bad command line); `cli/src/index.ts` maps commander's `CommanderError`s onto that. `--json` puts `{"ok":true,"data":…}` on stdout and `{"ok":false,"error":…}` on stderr — paged listings keep their `{page, …, items}` envelope. A structural test (`cli/src/test/structure.test.ts`) walks the commander tree and asserts every leaf documents itself and its flags, carries the global flags, and that the listing/`--check`/`--yes` contracts hold exactly where declared.
- **`describeError` only runs `parseAuthError` on errors that came off the wire.** That helper treats a missing `status` as 0 and rewrites the message to "Unable to reach the server" — right for the webapp, wrong for a CLI whose commands throw plain `Error`s whose message is the point.
- **The auth token is hydrated synchronously** in `cli/src/config.ts`. `AsyncAuthStore`'s own `initial` option loads on an internal queue with no public promise to await, so `authStore.isValid` is still false when the constructor returns — and a one-shot CLI reads it immediately. Hydration goes through `BaseAuthStore.prototype.save` rather than the subclass override, because the override would queue a write of what was just read and race `logout`'s delete.

### Schema definitions vs. migrations

`shared/src/schema/*.ts` is where collection fields and API rules are *authored*, but the database is created from the committed JS migrations in `pocketbase/pb_migrations/`, which PocketBase auto-applies on boot. **Editing a zod schema does not change the database** — run `yarn db:status` to see the drift, then `yarn db:generate` to write the migration.

`pocketbase-migrate.config.mjs` (repo root) points the CLI at `shared/src/schema` and `pocketbase/pb_migrations`; `schema.exclude` is intentionally left at its default so the `index.ts` barrel **and `permissions.ts`** stay out of schema discovery. `verify: true` round-trips `up()`/`down()` before writing, so a migration that can't roll back is refused.

Two things `db:generate` cannot work out on its own, both of which cost real debugging in Phase 5:

- **PocketBase validates an API rule against the schema when the collection is saved.** A collection whose rules traverse a relation cannot be created before that relation exists, and two collections that reference each other (`Workspaces` ↔ `WorkspaceMembers`) have to be created with placeholder rules and joined up in a third migration. Reordering and splitting the generated files is normal when rules change; verify by running `./pocketbase migrate up --dir=/tmp/x` against a **fresh** directory, which is the only thing that catches ordering.
- **An index name cannot be reused across a swap in one migration** — adding before dropping fails with "The index name already exists". Give the replacement a different name.

A schema change that needs data (adding a required column and pointing existing rows at it) is three migrations, not one: add the column *not required*, backfill, then require it and swap the rules. Test the backfill on a database that actually has rows — `pb_migrations/1786153904_backfill_workspaces.js` is the worked example.

`db:status` **exits 0 even when drift exists**, so never treat it as a gate; parse `pocketbase-migrate status --json` (`"status": "changes-pending"`) for that. `db:verify` and `db:lint` do exit non-zero.

`yarn typegen` writes `shared/src/types/pocketbase-types.ts` (kept out of the schema directory so generated output is never parsed as a collection definition). Nothing imports it yet — the generated `TypedPocketBase` types only the capitalized collection names, so it is not a drop-in replacement for the hand-written ones described below.

### Authorization lives in PocketBase rules

Workspace scoping is enforced by collection rules, so mutators intentionally set no user filter. The flip side: `GraphMutator.create` injects both `owner` and `workspace` itself, because `createRule` requires `owner` to match the caller and `workspace` to be one they can write.

Child collections carry **no denormalized scope column** — `GraphNodes`, `GraphImports`, `GraphEdgeOverrides` and `GraphVersions` resolve through their parent relation (`graph.workspace`, `parent.workspace`). A copied column is one join cheaper and one more thing that can drift.

Read rules admit anything not `private` **before** the membership test, so a graph imported from another workspace's library resolves for the importer. Without that, the parent would be readable and the child would silently resolve to nothing.

The membership expressions are built once in `shared/src/schema/permissions.ts` (`memberOf` / `writerOf` / `adminOf`) and composed at whatever relation depth a collection needs. Two things about them:

- **`?=` and `?!=` are load-bearing.** A back-relation matches many rows; `members.user ?= me && members.role ?!= "viewer"` only means what it looks like because both conditions resolve against the same join, and therefore the same roll row. Get this wrong and every viewer can write.
- **`permissions.ts` is on `pocketbase-migrate`'s default `schema.exclude` list**, which is how a file with no `defineCollection` export can live in `shared/src/schema/`. One more reason that list must stay at its default.

`shared/src/schema/workspace-member.ts` mirrors the role rules in TypeScript (`roleCanWrite`, `roleCanAdminister`) for the UI. Advisory only — change one, change the other.

### Two things live in pb_hooks

**Cycle prevention.**

PocketBase API rules can follow a relation one level at a time but **cannot walk an ancestor chain**, and "does this import close a loop?" is recursive. So it is enforced in `pocketbase/pb_hooks/graph-imports.pb.js`, which rejects self-imports, cycles, and chains deeper than `MAX_IMPORT_DEPTH`.

`shared/src/lib/graph/imports.ts` mirrors the same rules client-side — advisory only, for editor UX and unit tests. **Change one, change the other.**

Two goja constraints when touching hooks:

- Handler callbacks run in isolated runtimes and **cannot close over module-scope variables**. That's why each handler `require()`s `graph-imports-guard.js` instead of calling a function defined above it.
- Guard code is ES5: no arrow functions, template literals, spread, or destructuring. `yarn db:lint` only checks migrations, so hook compatibility is verified by actually booting PocketBase.

Only `*.pb.js` files are auto-loaded as hooks; a plain `.js` file next to them is require-able but inert.

**Personal-workspace provisioning.** `pocketbase/pb_hooks/workspaces.pb.js` gives every new user a workspace and an admin seat on it. This cannot be the client's job: signup goes through the auth endpoint, and a client that forgets the second call leaves an account that can create nothing, because `Graphs.workspace` is required. `pb_migrations/1786153904_backfill_workspaces.js` does the same for users who predate Phase 5 — change one, change the other.

Its hook tag is `'Users'`, **capitalized**: that is the collection's real name, and a hook tag is matched against it exactly. The lowercase `users` that works in SDK calls and URLs is routing sugar. A mistyped tag fails by silently never firing.

### Auth state

`pb.authStore` is the source of truth; `AuthProvider` (mounted globally in `app/layout.tsx`) mirrors it via `authStore.onChange` and revalidates with `authRefresh()` on mount, every 5 minutes, on window focus, and on `online`. Read auth through `useAuth()`, never by re-reading `authStore` in components.

Feature providers, by contrast, are mounted per-page rather than globally. When a provider combines optimistic updates with a realtime `'*'` subscription, writes can land twice — dedupe by id when adding to that path.

`WorkspaceProvider` is the one exception: it is mounted in the `(shell)` layout, because the active workspace decides what `/graphs` lists and where `/graphs/new` writes, and a choice that reset on every navigation would be worse than no choice. It is **not** mounted in `(viewer)`, which is a bare full-bleed layout — `GraphViewerProvider` loads its own membership for `canEdit` rather than depending on a provider that route does not have.

### Two PocketBase conventions the zod layer does not share

Both bit during Phase 5, and both are invisible from the schema files:

- **PocketBase returns `null` for an unset optional field; zod's `.optional()` rejects `null`.** Feeding a record's own values back into a `create` — which is what forking and restoring do — needs `?? undefined` on every optional JSON field, or validation fails on data the server itself produced.
- **A JSON field round-trips with its keys sorted.** PocketBase marshals it in Go, which sorts map keys, so `JSON.stringify(fromServer) !== JSON.stringify(justBuilt)` even for identical data. Compare canonically — `snapshotMatches` in `lib/graph/snapshot.ts` is the worked example.

Related: `lib/pocketbase.ts` sets `autoCancellation(false)`. The SDK's default cancel key is `method + path`, so two concurrent reads of the *same collection* would cancel each other — which several `Promise.all` call sites do deliberately. Any script that talks to PocketBase outside the app needs the same setting.

### Cross-cutting helpers

`parseAuthError` (`lib/errors.ts`) normalizes PocketBase `ClientResponseError` into `{type, message, fieldErrors}` for display; `withRetry` (`lib/retry.ts`) retries only network/5xx, never 4xx; `globalLoadingManager` (`lib/loading-manager.ts`) tracks named loading keys.

### Collection-name casing

Mutators call `pb.collection('Users')` (capitalized) while auth and realtime code call `'users'`. `'Users'` is the collection's real name — what a pb_hook tag is matched against, exactly — and `'users'` is PocketBase's routing sugar for the auth endpoints. Both casings are typed in the **one** `TypedPocketBase` in `shared/src/types/index.ts`; there used to be a second, looser copy in the webapp, and they were collapsed when the package was extracted. Register a new collection there and nowhere else.

## Testing

Vitest everywhere, in three configurations, and which one a test lands in is the point:

- **`shared/src/test/`** — `environment: 'node'`, no setup file, no aliases. The *absence* of happy-dom and the react plugin is the enforcement that everything here stays pure. The graph layer is the part most worth testing and all of it qualifies: value-object parsing (`lib/graph/primitives.ts`), instance addressing and import rules (`lib/graph/imports.ts`), the engine, snapshot serialization (`lib/graph/snapshot.ts`) and fork planning (the exported half of `lib/graph/clone.ts`).
- **`webapp/src/test/__tests__/`** — happy-dom, `globals: true`, `src/test/setup.ts` mocking `next/navigation`, `next/image`, `next/link` and `sonner`. Components, contexts and the XYFlow adapter.
- **`cli/src/test/`** — node environment, all offline. Alongside the unit tests there is a **structural** pass over the command registry asserting every command declares a usage line and does not shadow a global flag; that is what catches a *new* command breaking the `--json` contract.

Tests are excluded from ESLint in every workspace.

No live PocketBase is needed — use `@project/shared/test-fixtures` (`MockAuthStore`, `createMockPocketBase`, `createMockUser`, plus the sample graphs), which reproduces the `authStore.onChange` behavior contexts depend on. It lives in `shared` so the webapp and CLI share one copy rather than drifting. Fixtures reuse `example/data/*.json`, which already contains the interesting cases: a fan-out fuse (`many` in and out), two competing `one` outputs, and a filtered required input.

**Access rules are not testable here.** They are strings evaluated by PocketBase's filter engine, so `yarn db:verify-rules` covers them against a running server instead. It is deliberately outside `precommit`, which needs no server — but run it after touching anything in `shared/src/schema/`.

## Config and deployment

- `POCKETBASE_VERSION` in `.env.example` is the single source of truth for the binary version — `scripts/setup-pocketbase.js`, the Dockerfiles, and CI all read it from there. Bump it in that one file.
- `NEXT_PUBLIC_POCKETBASE_URL` is inlined at **build** time: `http://localhost:8090` for dev, `/` for the container images (same-origin behind nginx, so no CORS).
- `docker/Dockerfile` is the all-in-one image (nginx + Next.js + PocketBase under supervisord, all state in `/data`). `docker/Dockerfile.webapp` + `docker/Dockerfile.pocketbase` build the two halves separately; those images have no nginx, so a proxy has to put them on one origin. `NEXT_STANDALONE=1` (set only by `Dockerfile.webapp`) is the one thing that switches `next.config.ts` to `output: 'standalone'`.
- **Every workspace directory in the root `workspaces` array must exist in the build context**, even one the image never runs. `yarn install --immutable` resolves the workspace set before it does anything else, and a missing directory yields a different set than the lockfile records — the install fails with "the lockfile would have been modified", pointing at an unrelated package. The all-in-one image relocates `pocketbase/` to `/app/pb`, so it copies that `package.json` to *both* paths for exactly this reason. CI builds images only on release, so **build both Dockerfiles locally after touching the workspace list** — nothing else catches it.
- `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` are read by `docker/pb-entrypoint.sh`, which upserts that superuser on boot, and by `yarn db:seed`, which authenticates against a running server. The migration scripts need no credentials — they work off files on disk.
- Commit messages drive releases via release-please — use Conventional Commits (`feat:`, `fix:`, `feat!:`).
- Styling is Tailwind v4 CSS-first (`src/app/globals.css`, `@tailwindcss/postcss`); there is no `tailwind.config`. UI components come from shadcn/ui (`new-york`, lucide icons).

## Repo quirks

- `pocketbase-zod-schema` is declared in **both** `shared/package.json` (the schema files import it at runtime) and the root `package.json` (Yarn 4 only exposes a bin to the workspace that declares the dependency, so the root needs it for the `db:*` scripts). Keep the versions matched.
- **`zod` and `pocketbase` versions must be byte-identical across `shared`, `webapp` and `cli`.** Different ranges make Yarn install two copies, and cross-boundary `instanceof` silently stops working — a second `ClientResponseError` class would make `parseAuthError` degrade every PocketBase error to a generic message.
- `tsx` is a root devDependency so the `db:*` scripts can preload it, and a real **dependency** of `@project/cli`, where it is the runtime. It's also a transitive dependency of `pocketbase-zod-schema`; declaring it explicitly keeps both from depending on hoisting.
- `shared/package.json` sets `"type": "module"`. If `yarn db:status` ever regresses after touching it, that field is the first suspect — it changes how tsx loads the schema files for `pocketbase-migrate` (true ESM instead of CJS transpilation).
- `example/` is upstream reference material — the original Node-Ware docs and sample data. `yarn db:seed` reads `example/data/*.json`, and `shared`'s test fixtures import three of them; nothing in `webapp/` does.
- `scripts/seed-graphs.mjs` authenticates as a **superuser** and is deliberately not folded into the CLI: the CLI's value is that it exercises the ordinary collection rules, and an admin path inside it would dilute exactly that.
- CI runs no checks. `.github/workflows/release.yml` does release-please plus multi-arch image builds — lint, typecheck, and tests exist only in `yarn precommit`.
