# Docker Image

Single-container deployment of the Next.js webapp + PocketBase + Nginx, supervised by `supervisord`. All runtime state lives under `/data` — bind-mount that one path and you're done.

> To run the two halves as separate containers instead, see [Dockerfile.webapp](Dockerfile.webapp) and [Dockerfile.pocketbase](Dockerfile.pocketbase). Those images ship without nginx, so you supply the proxy or router that puts them on one origin.

## Architecture

- **Nginx** (port 80) — reverse proxy, public entry point
- **Next.js** (internal :3000) — frontend
- **PocketBase** (internal :8090) — API, admin UI, SQLite, file storage
- **Supervisor** — process manager

Hooks ([pocketbase/pb_hooks/](../pocketbase/pb_hooks/)) and migrations ([pocketbase/pb_migrations/](../pocketbase/pb_migrations/)) are baked into the image — they're code, not data. Source-tree path is `pocketbase/`; in the running container they live under `/app/pb/`.

## Build

From the repo root:

```bash
docker build -f docker/Dockerfile -t graph-ware .
```

The PocketBase version is sourced from [`.env.example`](../.env.example)
(`POCKETBASE_VERSION`) — that's the single place to bump it, and CI reads it from
there. The Dockerfile `ARG` default is only a fallback for a plain `docker build`.
Override it for a one-off build:

```bash
docker build -f docker/Dockerfile \
  --build-arg POCKETBASE_VERSION=0.39.9 \
  --build-arg POCKETBASE_ARCH=amd64 \
  -t graph-ware .
```

## Run

```bash
docker run -d --name graph-ware \
  -p 80:80 \
  -v $PWD/data:/data \
  graph-ware
```

Routes:

- `/` → Next.js
- `/api/` → PocketBase API
- `/_/` → PocketBase admin UI
- `/health` → PocketBase health probe

First boot: visit `/_/` to create the PocketBase admin account. To skip that and
provision the superuser automatically, pass `POCKETBASE_ADMIN_EMAIL` and
`POCKETBASE_ADMIN_PASSWORD` at `docker run` time (see [Environment variables](#environment-variables)).

## The `/data` contract

Everything the running container persists writes to `/data`:

- `/data/pb_data/` — PocketBase SQLite (`data.db`, `auxiliary.db`) and file uploads (`storage/`)

Reserve the rest of `/data` for any future app-level dynamic state (cache, generated files). Mount one host directory to that path and your container is stateful; nothing else needs to be persisted.

The Dockerfile declares `VOLUME ["/data"]`, so an unconfigured `docker run` still gets a Docker-managed volume — you won't lose data by forgetting `-v`. Bind-mount in production for predictable backups.

### Backup and restore

```bash
# Back up
tar czf backup-$(date +%F).tgz -C $PWD data

# Restore on a fresh host
tar xzf backup-2026-05-05.tgz
docker run -d --name graph-ware -p 80:80 -v $PWD/data:/data graph-ware
```

Stop the container before backing up if you need a strictly consistent SQLite snapshot. PocketBase also exposes backup tooling at `/_/#/settings/backups` if you prefer in-app snapshots.

## Environment variables

Pass at `docker run` time:

```bash
docker run -d --name graph-ware \
  -p 80:80 \
  -v $PWD/data:/data \
  -e NEXT_PUBLIC_POCKETBASE_URL=https://your-domain/api \
  -e NODE_ENV=production \
  -e POCKETBASE_ADMIN_EMAIL=admin@your-domain \
  -e POCKETBASE_ADMIN_PASSWORD='a-strong-password' \
  graph-ware
```

See [.env.example](../.env.example) for the full list.

### Superuser provisioning

When both `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` are present in the
container env, the PocketBase entrypoint runs an idempotent `superuser upsert` before
starting the server — so a fresh deploy comes up with that superuser already created
(and re-running with the same vars resets the password). It's safe to leave them set
across restarts.

Omit them to keep PocketBase's default behavior: on first boot it prints a one-time
setup URL (`/_/#/pbinstal/...`) to the logs — find it with
`docker logs <container>` — and you create the account through the admin UI.

## Logs

Supervisor writes per-process logs inside the container:

- `/var/log/supervisor/supervisord.log`
- `/var/log/supervisor/pocketbase.{out,err}.log`
- `/var/log/supervisor/nextjs.{out,err}.log`
- `/var/log/supervisor/nginx.{out,err}.log`

Tail them with `docker exec <container> tail -f /var/log/supervisor/supervisord.log`.

## Published images (CI / release-please)

[`.github/workflows/release.yml`](../.github/workflows/release.yml) publishes all three
images to **GitHub Container Registry** on every release:

| Image | Dockerfile | Contents |
|-------|------------|----------|
| `ghcr.io/<owner>/<repo>/monolith` | [Dockerfile](Dockerfile) | All-in-one (Next.js + PocketBase + nginx) |
| `ghcr.io/<owner>/<repo>/webapp` | [Dockerfile.webapp](Dockerfile.webapp) | Next.js standalone server (split deployment) |
| `ghcr.io/<owner>/<repo>/pocketbase` | [Dockerfile.pocketbase](Dockerfile.pocketbase) | PocketBase + hooks + migrations (split deployment) |

**Versioning** is driven by [release-please](https://github.com/googleapis/release-please)
using Conventional Commits (`feat:`, `fix:`, `feat!:`/`BREAKING CHANGE:`). It keeps a
release PR open on `main`; merging it cuts a `vX.Y.Z` tag + GitHub release and updates
[CHANGELOG.md](../CHANGELOG.md). That release run then builds and pushes the images, tagged
`X.Y.Z`, `X.Y`, `X`, and `latest`. All three images share one version.

**Multi-arch & compute:** each image is built for `linux/amd64` and `linux/arm64` on a
**native** runner in parallel (no QEMU), pushed by digest, then merged into one multi-arch
manifest per image. Layer caching is scoped per image+arch via the Actions cache.

No registry secret is needed — the workflow authenticates with the built-in `GITHUB_TOKEN`
(`packages: write`). New packages default to private; make them public via the package
settings on GitHub if desired.

## Files in this directory

- [Dockerfile](Dockerfile) — multi-stage build
- [supervisord.conf](supervisord.conf) — process definitions; PocketBase is launched through `pb-entrypoint.sh` with `--dir=/data/pb_data` plus `--hooksDir` / `--migrationsDir` pinned against the in-image paths
- [pb-entrypoint.sh](pb-entrypoint.sh) — PocketBase launch wrapper (shared with [Dockerfile.pocketbase](Dockerfile.pocketbase)); upserts a superuser when admin creds are in the env, then execs `serve`
- [nginx.conf](nginx.conf) — reverse-proxy routing, websocket support for PocketBase realtime
- [start.sh](start.sh) — entrypoint that execs supervisord
