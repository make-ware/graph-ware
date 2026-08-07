# Graph Ware

A flowchart and schematic builder for hardware-like systems — boats, circuits,
power distribution — where components declare typed connection points and **the
wiring is derived, not drawn**.

You describe what each component is and what it accepts or provides. The
connections fall out of that: an output reaches inputs of the same kind, subject
to fan-out limits and attribute filters. A required input that nothing satisfies
is reported as an error rather than quietly left dangling.

Graphs compose by reference. A `BatterySystem` defined once is a component, and
a system can import it as many times as it physically contains it — a port bank
and a starboard bank are two instances of one definition, not two copies.

## Stack

- **Next.js 16** (App Router) + **React 19**, **Tailwind CSS v4**, **shadcn/ui**,
  **react-hook-form** + **zod**
- **PocketBase** — API, auth, SQLite, file uploads, realtime, admin UI
- **@xyflow/react** for the canvas
- **TypeScript** end to end, **Yarn 4** workspaces monorepo
- **Docker** — single all-in-one container, or separate webapp / PocketBase images
- **release-please** + **GitHub Actions** → versioned multi-arch images on GHCR

## Status

Built in phases; see the [roadmap](docs/phases/README.md).

| Phase | | |
|---|---|---|
| 1 | [Data model](docs/phases/PHASE_1_DATA_MODEL.md) | **Done** — collections, rules, cycle guard, mutators, seed |
| 2 | [Graph engine](docs/phases/PHASE_2_GRAPH_ENGINE.md) | Next — resolve, flatten, auto-connect, validate, layout |
| 3 | [Viewer](docs/phases/PHASE_3_VIEWER.md) | Planned |
| 4 | [Editor](docs/phases/PHASE_4_EDITOR.md) | Planned |
| 5 | [Library and sharing](docs/phases/PHASE_5_LIBRARY_AND_SHARING.md) | Planned |
| 6 | [Interop](docs/phases/PHASE_6_INTEROP.md) | Planned |

Today the app ships auth (`/signup`, `/login`, `/profile`) and the full data
layer. There is no graph UI yet — inspect data through the PocketBase admin UI.

## Quick start

Requires **Node 20+**, **Yarn 4** (via Corepack), and a POSIX shell.

```bash
corepack enable          # enables the pinned Yarn 4
yarn install
yarn setup               # download the PocketBase binary for your platform
yarn dev                 # Next.js (:3000) + PocketBase (:8090)
```

- App → <http://localhost:3000>
- PocketBase admin UI → <http://localhost:8090/_/> (create the first superuser on
  first visit, or `cd pocketbase && ./pocketbase superuser upsert EMAIL PASS`)

Then load the sample system:

```bash
yarn db:seed
```

That creates a demo user (`demo@example.com` / `demo-password-1234`) and the
three sample graphs from `example/data/`. `testDataElement` imports
`BatterySystem` **twice** — as `port_bank` and `starboard_bank` — which is the
case worth looking at first.

Configuration lives in `.env`, copied from [.env.example](.env.example).

## The model in one screen

```
Graphs ────────────── a system, subsystem, or reusable library
  ├── GraphNodes ──── elements; ports and attributes are JSON on the record
  ├── GraphImports ── this graph imports that one, under an alias
  └── GraphEdgeOverrides ── pin or suppress one derived connection

PortKinds ─────────── shared registry of connection types and their colours
```

- **No edges are stored.** They are computed from port compatibility at render
  time.
- **A child can be imported more than once**, so a node's record id is not
  unique within a resolved tree. Everything derived is keyed by an *instance
  path* — the chain of import aliases plus the node id.
- **Authorization is in PocketBase rules.** Mutators set no user filter; a
  mutator's `create` injects `owner` because the create rule requires it to
  match the caller.

Full reference: [docs/DATA_MODEL.md](docs/DATA_MODEL.md). Rationale:
[docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
graph-ware/
├── webapp/              # @project/webapp — Next.js app
│   └── src/
│       ├── app/         # routes
│       ├── schema/      # zod collection definitions + PocketBase access rules
│       ├── mutators/    # typed CRUD over the PocketBase SDK
│       ├── services/    # auth operations
│       ├── contexts/    # React state + realtime subscriptions
│       ├── components/  # shadcn/ui primitives in ui/, features alongside
│       └── lib/
│           └── graph/   # value objects, instance paths, import rules
├── pocketbase/          # @project/pb — binary (downloaded), hooks, migrations
│   ├── pb_hooks/        # server-side JS hooks, incl. the import cycle guard
│   └── pb_migrations/   # schema migrations (auto-applied on boot)
├── example/             # upstream Node-Ware docs + sample data (reference)
├── docker/              # Dockerfile (monolith) + Dockerfile.webapp / .pocketbase
├── docs/                # design, data model, imports, engine, phases, PB guides
└── .github/workflows/   # release.yml — release-please + image publishing
```

> `@project/shared` is a TypeScript path alias into `webapp/src` (declared in
> `webapp/tsconfig.json` and `webapp/vitest.config.mjs`), not a separate package.

All data access is **client-side** — the browser talks to PocketBase directly via
the JS SDK. There are no route handlers or server actions; see
[docs/PB_SSR.md](docs/PB_SSR.md) for why.

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

The zod collection definitions in `webapp/src/schema/` are where fields and API
rules are *authored*; the files in `pocketbase/pb_migrations/` are what
PocketBase actually applies on boot. **Editing a zod schema does not change the
database** — generate a migration for it.

| Script | Description |
|--------|-------------|
| `yarn db:status` | Diff the zod schemas against the committed migrations |
| `yarn db:verify` | Check which migrations the local database has applied |
| `yarn db:generate` | Write a migration for the pending schema changes |
| `yarn db:lint` | Catch JS that Node accepts but PocketBase's goja runtime rejects |
| `yarn db:seed` | Load `example/data/` into a running PocketBase |
| `yarn typegen` | Generate `webapp/src/types/pocketbase-types.ts` from the schemas |

`db:status` **exits 0 even when it reports drift** — parse
`pocketbase-migrate status --json` (`"status": "changes-pending"`) if you want to
gate a build on it. `db:verify` and `db:lint` do exit non-zero.

The `db:*` scripts preload `tsx` via `NODE_OPTIONS`; without it the migrate CLI
fails on Node 22 with `Cannot require() ES Module … in a cycle`.

## Adding a collection

1. Define it in `webapp/src/schema/<name>.ts` with `defineCollection` (fields
   **and** access rules) and export it from `webapp/src/schema/index.ts`.
2. `yarn db:status` → `yarn db:generate` to write the migration; restart
   PocketBase to apply it.
3. Add a `BaseMutator` subclass in `webapp/src/mutators/` and export it from the
   barrel.
4. Add the collection to the `TypedPocketBase` interfaces in
   `webapp/src/lib/types.ts` **and** `webapp/src/types/index.ts`.

Per-user scoping is enforced by PocketBase rules, so mutators set no user filter
— but a mutator's `create` must inject `owner: pb.authStore.record.id` itself,
because the create rule requires it to match the caller.

## Configuration

See [.env.example](.env.example). Key variables:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `POCKETBASE_VERSION` | setup script, Dockerfiles, CI | Single source of truth for the PocketBase binary version |
| `NEXT_PUBLIC_POCKETBASE_URL` | webapp (build-time, client-side) | Base URL the browser uses for PocketBase. `http://localhost:8090` for dev; `/` when a proxy puts both on one origin |
| `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | container entrypoint, `yarn db:seed` | When both are set, the entrypoint upserts this superuser on boot |

> `NEXT_PUBLIC_*` is inlined into the JS bundle **at build time**, so the
> container images set it to `/` (same-origin via the bundled proxy) — no CORS
> needed.

## Deployment

Single container — Next.js + PocketBase + nginx under supervisor, all state in
`/data`:

```bash
docker build -f docker/Dockerfile -t graph-ware .
docker run -d -p 80:80 -v "$PWD/data:/data" graph-ware
```

`docker/Dockerfile.webapp` and `docker/Dockerfile.pocketbase` build the two
halves separately; those images have no nginx, so front them with your own proxy
to keep one origin. Details and backups: [docker/README.md](docker/README.md).

Each release publishes multi-arch images to
`ghcr.io/<owner>/<repo>/{monolith,webapp,pocketbase}`. Versioning is driven by
**release-please** from
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`feat!:`).

## Documentation

**Graph Ware** — [design](docs/DESIGN.md) ·
[data model](docs/DATA_MODEL.md) · [child graph imports](docs/IMPORTS.md) ·
[graph engine](docs/GRAPH_ENGINE.md) · [roadmap](docs/phases/README.md)

**PocketBase** — [intro](docs/PB_INTRO.md) ·
[collections](docs/PB_COLLECTIONS.md) · [auth](docs/PB_AUTH.md) ·
[relationships](docs/PB_RELATIONSHIPS.md) · [filters](docs/PB_FILTERS.md) ·
[realtime](docs/PB_REALTIME.md) · [uploads](docs/PB_UPLOADS.md) ·
[SSR](docs/PB_SSR.md) · [extending with hooks](docs/PB_EXTENDING.md)

**Upstream** — [`example/`](example/) holds the original Node-Ware
documentation and sample data this project adapts.

## License

See [LICENSE](LICENSE).
