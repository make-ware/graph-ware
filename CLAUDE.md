# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Yarn 4 workspaces monorepo — run everything from the repo root. Workspaces: `@project/webapp` (Next.js), `@project/pb` (PocketBase).

```bash
yarn install
yarn setup            # download the PocketBase binary (gitignored; required before `yarn dev`)
yarn dev              # Next.js :3000 + PocketBase :8090 concurrently
yarn test             # vitest run (webapp only)
yarn typecheck        # tsc --noEmit per workspace
yarn lint             # eslint --fix   (yarn lint:check for no-fix)
yarn format           # prettier --write
yarn precommit        # lint + typecheck + format + test — the actual gate
```

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
yarn typegen        # generate webapp/src/types/pocketbase-types.ts from the schemas
```

The `db:*` scripts preload tsx via `NODE_OPTIONS="--import tsx"`. Without it the migrate CLI dies on Node 22 with `Cannot require() ES Module … in a cycle`. Don't strip it.

CI (`.github/workflows/release.yml`) only runs release-please and Docker image builds — it does **not** run lint, typecheck, or tests. `yarn precommit` is the only place those run.

PocketBase alone: `yarn workspace @project/pb dev` (`./pocketbase serve`). Admin UI at <http://localhost:8090/_/>; first visit creates the superuser.

## The domain

Graph-ware is a flowchart/schematic builder for hardware-like systems. Components declare typed ports; **the wiring between them is derived from port compatibility, not stored**. Design rationale in `docs/DESIGN.md`, collection reference in `docs/DATA_MODEL.md`, reuse semantics in `docs/IMPORTS.md`, the engine contract in `docs/GRAPH_ENGINE.md`, and the phased roadmap in `docs/phases/`.

Five domain collections: `Graphs`, `GraphNodes`, `GraphImports`, `GraphEdgeOverrides`, `PortKinds`.

Four rules that everything else follows from:

**Edges are not stored.** Connections are computed at render time by matching an output port to inputs of the same `kind`, honouring `one`/`many` relationship budgets and evaluating input-port attribute filters against the *source node's* attributes. The only persisted edge data is `GraphEdgeOverrides`, which patches that result (`pin` / `suppress`) rather than replacing it. Don't add an edge collection; extend port kinds and filters instead.

**Graphs compose by reference, and a child can be imported twice.** `GraphImports` is a join collection with a per-parent unique `alias`. Two rows may name the same child — that is the point, and it is what the old `childGraphs: string[]` model could not do.

**Instance paths, not record ids, identify anything derived.** Because a child can appear twice, one `GraphNodes` record can appear twice in a resolved tree. Flat nodes, edges, diagnostics, layout positions, canvas selection and `GraphEdgeOverrides` endpoints are all keyed by `buildInstanceId(instancePath, nodeId)` — the chain of import aliases plus the node id (`webapp/src/lib/graph/imports.ts`). Reaching for a record id in the derived layer looks correct until something is imported twice, then two components silently collapse into one.

**Hybrid normalization.** Graphs and nodes are records — they need rules, realtime, atomic writes. Ports and attributes are validated JSON *on the node*; they have no independent identity and nothing references them. To change their shape, edit `webapp/src/lib/graph/primitives.ts`, not the schema directory.

`webapp/src/lib/graph/primitives.ts` must **stay out of `webapp/src/schema/`**: `pocketbase-migrate` imports every file in that directory looking for a `defineCollection` export, and `schema.exclude` has to stay at its default.

Schema files import primitives with a **relative** path (`../lib/graph/primitives`), not `@/…` — the migrate CLI loads them through tsx from the repo root, where the webapp path alias isn't in scope.

## Architecture

Next.js frontend + PocketBase backend. **All data access is client-side**: the browser talks to PocketBase directly via the JS SDK. There are no route handlers, no server actions, and no server-side PocketBase client — every page under `webapp/src/app/` is `'use client'`. `docs/PB_SSR.md` explains why (a module-scoped `pb` instance would leak auth state across server requests) — keep new data access on the client.

Data flows in layers, top to bottom:

| Layer | Location | Role |
|---|---|---|
| Schema | `webapp/src/schema/*.ts` | zod + `pocketbase-zod-schema` `defineCollection` — field validation **and** PocketBase access rules |
| Value objects | `webapp/src/lib/graph/primitives.ts` | attributes, ports, filters — the JSON stored on a node |
| Mutators | `webapp/src/mutators/*.ts` | `BaseMutator` subclasses: typed CRUD, filter/sort/expand defaults, realtime subscribe |
| Services | `webapp/src/services/auth.ts` | high-level auth ops over the user mutator + `pb.authStore` |
| Contexts | `webapp/src/contexts/*.tsx` | React state, optimistic updates, subscription lifecycle |
| Components | `webapp/src/components/` | shadcn/ui primitives in `ui/`, feature components alongside |

`webapp/src/lib/graph/resolver.ts` and `engine.ts` sit between mutators and components: the resolver loads an import tree, the engine turns it into flat nodes, edges, diagnostics and positions. The engine must stay pure — no DOM, no network — which is what makes it testable.

### `@project/shared` is an alias, not a package

It resolves into `webapp/src` and is declared in **two places that must stay in sync**: `paths` in `webapp/tsconfig.json` and `resolve.alias` in `webapp/vitest.config.mjs`. Subpaths: bare `@project/shared` → `src/shared/index.ts` (schemas, graph primitives/import helpers, and `lib/{errors,retry,loading-manager}`), `/schema` → `src/schema/index.ts`, `/mutators` → `src/mutators/index.ts`. Mutators are deliberately kept out of the bare barrel.

### Schema definitions vs. migrations

`webapp/src/schema/*.ts` is where collection fields and API rules are *authored*, but the database is created from the committed JS migrations in `pocketbase/pb_migrations/`, which PocketBase auto-applies on boot. **Editing a zod schema does not change the database** — run `yarn db:status` to see the drift, then `yarn db:generate` to write the migration.

`pocketbase-migrate.config.mjs` (repo root) points the CLI at `webapp/src/schema` and `pocketbase/pb_migrations`; `schema.exclude` is intentionally left at its default so the `index.ts` barrel stays out of schema discovery. `verify: true` round-trips `up()`/`down()` before writing, so a migration that can't roll back is refused.

`db:status` **exits 0 even when drift exists**, so never treat it as a gate; parse `pocketbase-migrate status --json` (`"status": "changes-pending"`) for that. `db:verify` and `db:lint` do exit non-zero.

`yarn typegen` writes `webapp/src/types/pocketbase-types.ts` (kept out of the schema directory so generated output is never parsed as a collection definition). Nothing imports it yet — the generated `TypedPocketBase` types only the capitalized collection names, so it is not a drop-in replacement for the hand-written ones described below.

### Authorization lives in PocketBase rules

Per-user scoping is enforced by collection rules, so mutators intentionally set no user filter. The flip side: `GraphMutator.create` injects `owner: pb.authStore.record.id` itself, because `createRule` requires the field to match the caller. New owner-bearing collections should follow the same pattern.

Child collections carry **no denormalized `owner`** — `GraphNodes`, `GraphImports` and `GraphEdgeOverrides` resolve ownership through their parent relation (`graph.owner = @request.auth.id`, `parent.owner = @request.auth.id`). A copied owner column is one join cheaper and one more thing that can drift.

Read rules admit anything not `private` (`owner = @request.auth.id || visibility != "private"`), so a graph imported from another user's library resolves for the importer. Without that, the parent would be readable and the child would silently resolve to nothing.

### Cycle prevention lives in a pb_hook

PocketBase API rules can follow a relation one level at a time but **cannot walk an ancestor chain**, and "does this import close a loop?" is recursive. So it is enforced in `pocketbase/pb_hooks/graph-imports.pb.js`, which rejects self-imports, cycles, and chains deeper than `MAX_IMPORT_DEPTH`.

`webapp/src/lib/graph/imports.ts` mirrors the same rules client-side — advisory only, for editor UX and unit tests. **Change one, change the other.**

Two goja constraints when touching hooks:

- Handler callbacks run in isolated runtimes and **cannot close over module-scope variables**. That's why each handler `require()`s `graph-imports-guard.js` instead of calling a function defined above it.
- Guard code is ES5: no arrow functions, template literals, spread, or destructuring. `yarn db:lint` only checks migrations, so hook compatibility is verified by actually booting PocketBase.

Only `*.pb.js` files are auto-loaded as hooks; a plain `.js` file next to them is require-able but inert.

### Auth state

`pb.authStore` is the source of truth; `AuthProvider` (mounted globally in `app/layout.tsx`) mirrors it via `authStore.onChange` and revalidates with `authRefresh()` on mount, every 5 minutes, on window focus, and on `online`. Read auth through `useAuth()`, never by re-reading `authStore` in components.

Feature providers, by contrast, are mounted per-page rather than globally. When a provider combines optimistic updates with a realtime `'*'` subscription, writes can land twice — dedupe by id when adding to that path.

### Cross-cutting helpers

`parseAuthError` (`lib/errors.ts`) normalizes PocketBase `ClientResponseError` into `{type, message, fieldErrors}` for display; `withRetry` (`lib/retry.ts`) retries only network/5xx, never 4xx; `globalLoadingManager` (`lib/loading-manager.ts`) tracks named loading keys.

### Collection-name casing

Mutators call `pb.collection('Users')` (capitalized) while auth and realtime code call `'users'`. Both casings are typed in `webapp/src/lib/types.ts`; `webapp/src/types/index.ts` declares a second, stricter `TypedPocketBase` with only the capitalized names. Match whatever the surrounding file does, and add new collections to both interfaces.

## Testing

Vitest + happy-dom with `globals: true`. Tests live in `webapp/src/test/__tests__/` and are excluded from ESLint. `src/test/setup.ts` mocks `next/navigation`, `next/image`, `next/link`, and `sonner` globally.

No live PocketBase is needed — use `src/test/__tests__/fixtures/pocketbase.ts` (`MockAuthStore`, `createMockPocketBase`, `createMockUser`), which reproduces the `authStore.onChange` behavior contexts depend on.

The graph layer is the part most worth testing, and all of it is pure: value-object parsing (`lib/graph/primitives.ts`), instance addressing and import rules (`lib/graph/imports.ts`), and — once written — the engine. Fixtures should reuse `example/data/*.json`, which already contains the interesting cases: a fan-out fuse (`many` in and out), two competing `one` outputs, and a filtered required input.

## Config and deployment

- `POCKETBASE_VERSION` in `.env.example` is the single source of truth for the binary version — `scripts/setup-pocketbase.js`, the Dockerfiles, and CI all read it from there. Bump it in that one file.
- `NEXT_PUBLIC_POCKETBASE_URL` is inlined at **build** time: `http://localhost:8090` for dev, `/` for the container images (same-origin behind nginx, so no CORS).
- `docker/Dockerfile` is the all-in-one image (nginx + Next.js + PocketBase under supervisord, all state in `/data`). `docker/Dockerfile.webapp` + `docker/Dockerfile.pocketbase` build the two halves separately; those images have no nginx, so a proxy has to put them on one origin. `NEXT_STANDALONE=1` (set only by `Dockerfile.webapp`) is the one thing that switches `next.config.ts` to `output: 'standalone'`.
- `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` are read by `docker/pb-entrypoint.sh`, which upserts that superuser on boot, and by `yarn db:seed`, which authenticates against a running server. The migration scripts need no credentials — they work off files on disk.
- Commit messages drive releases via release-please — use Conventional Commits (`feat:`, `fix:`, `feat!:`).
- Styling is Tailwind v4 CSS-first (`src/app/globals.css`, `@tailwindcss/postcss`); there is no `tailwind.config`. UI components come from shadcn/ui (`new-york`, lucide icons).

## Repo quirks

- `pocketbase-zod-schema` is declared in **both** `webapp/package.json` (the schema files import it at runtime) and the root `package.json` (Yarn 4 only exposes a bin to the workspace that declares the dependency, so the root needs it for the `db:*` scripts). Keep the versions matched.
- `tsx` is a root devDependency purely so the `db:*` scripts can preload it. It's also a transitive dependency of `pocketbase-zod-schema`; declaring it explicitly keeps the scripts from depending on hoisting.
- `example/` is upstream reference material — the original Node-Ware docs and sample data. `yarn db:seed` reads `example/data/*.json`, so it isn't dead weight, but nothing in `webapp/` imports from it.
- CI runs no checks. `.github/workflows/release.yml` does release-please plus multi-arch image builds — lint, typecheck, and tests exist only in `yarn precommit`.
