# {{PROJECT_TITLE}}

{{PROJECT_DESCRIPTION}}

Built on [Next.js](https://nextjs.org/) + [PocketBase](https://pocketbase.io/): PocketBase provides
the backend (SQLite, auth, file storage, realtime, admin UI) and Next.js the frontend.

## Stack

- **Next.js 16** (App Router) + **React 19**, **Tailwind CSS v4**, **shadcn/ui**, **react-hook-form** + **zod**
- **PocketBase** — API, auth, SQLite, file uploads, realtime, admin UI
- **TypeScript** end to end
- **Yarn 4** workspaces monorepo
- **Docker** — single all-in-one container, or separate webapp / PocketBase images
- **release-please** + **GitHub Actions** → versioned multi-arch images on GHCR

<!-- IF_EXAMPLE -->
## What's included

- **Auth** — sign up, log in, profile (`/signup`, `/login`, `/profile`)
- **Todos** — an example `Todos` collection with per-user access rules and a CRUD UI (`/todos`),
  kept from the template as a worked example of the schema → mutator → context → UI path. Delete it
  once your own collections replace it.

<!-- END_IF_EXAMPLE -->
<!-- IF_NO_EXAMPLE -->
## What's included

- **Auth** — sign up, log in, profile (`/signup`, `/login`, `/profile`), backed by PocketBase's
  `users` collection
- The data layer (`schema/` → `mutators/` → `contexts/`) wired end to end and ready for your own
  collections

<!-- END_IF_NO_EXAMPLE -->
## Quick start

Requires **Node 20+**, **Yarn 4** (via Corepack), and a POSIX shell.

```bash
corepack enable          # enables the pinned Yarn 4
yarn install             # install dependencies
yarn setup               # download the PocketBase binary for your platform
yarn dev                 # Next.js (:3000) + PocketBase (:8090)
```

- App → <http://localhost:3000>
- PocketBase admin UI → <http://localhost:8090/_/> (create the first superuser on first visit)

Configuration lives in `.env` (copied from [.env.example](.env.example) during setup).

## Layout

```
{{PROJECT_NAME}}/
├── webapp/              # {{SCOPE}}/webapp — Next.js app
│   └── src/
│       ├── app/         # routes
│       ├── schema/      # zod collection definitions + PocketBase access rules
│       ├── mutators/    # typed CRUD over the PocketBase SDK
│       ├── services/    # auth operations
│       ├── contexts/    # React state + realtime subscriptions
│       ├── components/  # shadcn/ui primitives in ui/, features alongside
│       └── lib/         # pocketbase client, errors, retry, loading manager
├── pocketbase/          # {{SCOPE}}/pb — binary (downloaded), hooks, migrations
│   ├── pb_hooks/        # server-side JS hooks
│   └── pb_migrations/   # schema migrations (auto-applied on boot)
├── docker/              # Dockerfile (monolith) + Dockerfile.webapp / .pocketbase
├── docs/                # PocketBase usage guides
└── .github/workflows/   # release.yml — release-please + image publishing
```

> `{{SCOPE}}/shared` is a TypeScript path alias into `webapp/src` (declared in
> `webapp/tsconfig.json` and `webapp/vitest.config.mjs`), not a separate package.

All data access is **client-side** — the browser talks to PocketBase directly via the JS SDK. There
are no route handlers or server actions; see [docs/PB_SSR.md](docs/PB_SSR.md) for why.

## Scripts

Run everything from the repo root.

| Script | Description |
|--------|-------------|
| `yarn dev` | Run Next.js + PocketBase concurrently |
| `yarn build` | Build all workspaces |
| `yarn test` | Run webapp tests (Vitest) |
| `yarn typecheck` | Type-check all workspaces |
| `yarn lint` / `yarn format` | Lint-fix / format |
| `yarn precommit` | Lint + typecheck + format + test — the actual gate |
| `yarn setup` | (Re)download the PocketBase binary |

### Schema and migrations

The zod collection definitions in `webapp/src/schema/` are where fields and API rules are
*authored*; the files in `pocketbase/pb_migrations/` are what PocketBase actually applies on boot.
**Editing a zod schema does not change the database** — generate a migration for it.

| Script | Description |
|--------|-------------|
| `yarn db:status` | Diff the zod schemas against the committed migrations |
| `yarn db:verify` | Check which migrations the local database has applied |
| `yarn db:generate` | Write a migration for the pending schema changes |
| `yarn db:lint` | Catch JS that Node accepts but PocketBase's goja runtime rejects |
| `yarn typegen` | Generate `webapp/src/types/pocketbase-types.ts` from the schemas |

`db:status` **exits 0 even when it reports drift** — parse `pocketbase-migrate status --json`
(`"status": "changes-pending"`) if you want to gate a build on it. `db:verify` and `db:lint` do exit
non-zero.

## Adding a collection

1. Define it in `webapp/src/schema/<name>.ts` with `defineCollection` (fields **and** access rules)
   and export it from `webapp/src/schema/index.ts`.
2. `yarn db:status` → `yarn db:generate` to write the migration; restart PocketBase to apply it.
3. Add a `BaseMutator` subclass in `webapp/src/mutators/` and export it from the barrel.
4. Add the collection to the `TypedPocketBase` interfaces in `webapp/src/lib/types.ts` and
   `webapp/src/types/index.ts`.

Per-user scoping is enforced by PocketBase rules (e.g. `@request.auth.id != "" && user =
@request.auth.id`), so mutators set no user filter — but a mutator's `create` must inject
`user: pb.authStore.record.id` itself, because the create rule requires it to match the caller.

## Configuration

See [.env.example](.env.example). Key variables:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `POCKETBASE_VERSION` | setup script, Dockerfiles, CI | Single source of truth for the PocketBase binary version |
| `NEXT_PUBLIC_POCKETBASE_URL` | webapp (build-time, client-side) | Base URL the browser uses for PocketBase. `http://localhost:8090` for dev; `/` when a proxy puts both on one origin |
| `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | container entrypoint | When both are set, the entrypoint upserts this superuser on boot |

> `NEXT_PUBLIC_*` is inlined into the JS bundle **at build time**, so the container images set it to
> `/` (same-origin via the bundled proxy) — no CORS needed.

## Deployment

Single container — Next.js + PocketBase + nginx under supervisor, all state in `/data`:

```bash
docker build -f docker/Dockerfile -t {{PROJECT_NAME}} .
docker run -d -p 80:80 -v "$PWD/data:/data" {{PROJECT_NAME}}
```

`docker/Dockerfile.webapp` and `docker/Dockerfile.pocketbase` build the two halves separately; those
images have no nginx, so front them with your own proxy to keep one origin. Details and backups:
[docker/README.md](docker/README.md).

Each release publishes multi-arch images to `ghcr.io/<owner>/<repo>/{monolith,webapp,pocketbase}`.
Versioning is driven by **release-please** from
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:`).

## Documentation

PocketBase usage guides live in [docs/](docs/): [intro](docs/PB_INTRO.md),
[collections](docs/PB_COLLECTIONS.md), [auth](docs/PB_AUTH.md),
[relationships](docs/PB_RELATIONSHIPS.md), [filters](docs/PB_FILTERS.md),
[realtime](docs/PB_REALTIME.md), [uploads](docs/PB_UPLOADS.md),
[SSR](docs/PB_SSR.md), and [extending with hooks](docs/PB_EXTENDING.md).

## License

See [LICENSE](LICENSE).
