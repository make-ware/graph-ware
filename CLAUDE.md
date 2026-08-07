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
yarn typegen        # generate webapp/src/types/pocketbase-types.ts from the schemas
```

CI (`.github/workflows/release.yml`) only runs release-please and Docker image builds — it does **not** run lint, typecheck, or tests. `yarn precommit` is the only place those run.

PocketBase alone: `yarn workspace @project/pb dev` (`./pocketbase serve`). Admin UI at <http://localhost:8090/_/>; first visit creates the superuser.

## Architecture

Next.js frontend + PocketBase backend. **All data access is client-side**: the browser talks to PocketBase directly via the JS SDK. There are no route handlers, no server actions, and no server-side PocketBase client — every page under `webapp/src/app/` is `'use client'`. `docs/PB_SSR.md` explains why (a module-scoped `pb` instance would leak auth state across server requests) — keep new data access on the client.

Data flows in layers, top to bottom:

| Layer | Location | Role |
|---|---|---|
| Schema | `webapp/src/schema/*.ts` | zod + `pocketbase-zod-schema` `defineCollection` — field validation **and** PocketBase access rules |
| Mutators | `webapp/src/mutators/*.ts` | `BaseMutator` subclasses: typed CRUD, filter/sort/expand defaults, realtime subscribe |
| Services | `webapp/src/services/auth.ts` | high-level auth ops over the user mutator + `pb.authStore` |
| Contexts | `webapp/src/contexts/*.tsx` | React state, optimistic updates, subscription lifecycle |
| Components | `webapp/src/components/` | shadcn/ui primitives in `ui/`, feature components alongside |

### `@project/shared` is an alias, not a package

It resolves into `webapp/src` and is declared in **two places that must stay in sync**: `paths` in `webapp/tsconfig.json` and `resolve.alias` in `webapp/vitest.config.mjs`. Subpaths: bare `@project/shared` → `src/shared/index.ts` (schemas + `lib/{errors,retry,loading-manager}` only), `/schema` → `src/schema/index.ts`, `/mutators` → `src/mutators/index.ts`. Mutators are deliberately kept out of the bare barrel.

### Schema definitions vs. migrations

`webapp/src/schema/*.ts` is where collection fields and API rules are *authored*, but the database is created from the committed JS migrations in `pocketbase/pb_migrations/`, which PocketBase auto-applies on boot. **Editing a zod schema does not change the database** — run `yarn db:status` to see the drift, then `yarn db:generate` to write the migration.

`pocketbase-migrate.config.mjs` (repo root) points the CLI at `webapp/src/schema` and `pocketbase/pb_migrations`; `schema.exclude` is intentionally left at its default so the `index.ts` barrel stays out of schema discovery. `verify: true` round-trips `up()`/`down()` before writing, so a migration that can't roll back is refused.

`db:status` **exits 0 even when drift exists**, so never treat it as a gate; parse `pocketbase-migrate status --json` (`"status": "changes-pending"`) for that. `db:verify` and `db:lint` do exit non-zero.

`yarn typegen` writes `webapp/src/types/pocketbase-types.ts` (kept out of the schema directory so generated output is never parsed as a collection definition). Nothing imports it yet — the generated `TypedPocketBase` types only the capitalized collection names, so it is not a drop-in replacement for the hand-written ones described below.

### Authorization lives in PocketBase rules

Per-user scoping is enforced by collection rules (e.g. `@request.auth.id != "" && user = @request.auth.id`), so mutators intentionally set no user filter. The flip side: a per-user collection's `create` must inject `user: pb.authStore.record.id` itself, because `createRule` requires the field to match the caller. New per-user collections should follow the same pattern.

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

## Config and deployment

- `POCKETBASE_VERSION` in `.env.example` is the single source of truth for the binary version — `scripts/setup-pocketbase.js`, the Dockerfiles, and CI all read it from there. Bump it in that one file.
- `NEXT_PUBLIC_POCKETBASE_URL` is inlined at **build** time: `http://localhost:8090` for dev, `/` for the container images (same-origin behind nginx, so no CORS).
- `docker/Dockerfile` is the all-in-one image (nginx + Next.js + PocketBase under supervisord, all state in `/data`). `docker/Dockerfile.webapp` + `docker/Dockerfile.pocketbase` build the two halves separately; those images have no nginx, so a proxy has to put them on one origin. `NEXT_STANDALONE=1` (set only by `Dockerfile.webapp`) is the one thing that switches `next.config.ts` to `output: 'standalone'`.
- `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` are read only by `docker/pb-entrypoint.sh`, which upserts that superuser on boot. The migration scripts need no credentials — they work off files on disk.
- Commit messages drive releases via release-please — use Conventional Commits (`feat:`, `fix:`, `feat!:`).
- Styling is Tailwind v4 CSS-first (`src/app/globals.css`, `@tailwindcss/postcss`); there is no `tailwind.config`. UI components come from shadcn/ui (`new-york`, lucide icons).

## Repo quirks

- `pocketbase-zod-schema` is declared in **both** `webapp/package.json` (the schema files import it at runtime) and the root `package.json` (Yarn 4 only exposes a bin to the workspace that declares the dependency, so the root needs it for the `db:*` scripts). Keep the versions matched.
- CI runs no checks. `.github/workflows/release.yml` does release-please plus multi-arch image builds — lint, typecheck, and tests exist only in `yarn precommit`.
