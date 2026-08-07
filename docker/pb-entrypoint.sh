#!/bin/sh
# PocketBase launch wrapper, shared by the monolithic image (via supervisord) and
# the standalone PocketBase image (via ENTRYPOINT).
#
# If superuser credentials are provided in the environment, ensure that superuser
# exists with an idempotent `superuser upsert` before the server starts. This is
# what makes an unattended Docker deploy come up already-provisioned.
#
# If the credentials are NOT set, we skip the upsert entirely and fall through to
# the unchanged `pocketbase serve` — PocketBase then prints its one-time setup URL
# to the logs on first boot, exactly as before.
#
# Serve flags are passed through as arguments, so the two images keep owning their
# own --http/--dir/--hooksDir/--migrationsDir values.
set -e

# Binary + data dir. PB_DATA must match the --dir passed to `serve` so the upsert
# writes into the same database the server will open.
PB_BIN="${PB_BIN:-./pocketbase}"
PB_DATA="${PB_DATA:-/data/pb_data}"

if [ -n "$POCKETBASE_ADMIN_EMAIL" ] && [ -n "$POCKETBASE_ADMIN_PASSWORD" ]; then
  echo "[pb-entrypoint] POCKETBASE_ADMIN_EMAIL set — ensuring superuser '$POCKETBASE_ADMIN_EMAIL' exists..."
  "$PB_BIN" superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD" --dir="$PB_DATA"
else
  echo "[pb-entrypoint] POCKETBASE_ADMIN_EMAIL/POCKETBASE_ADMIN_PASSWORD not set — skipping superuser creation; PocketBase will print a setup URL on first boot."
fi

exec "$PB_BIN" serve "$@"
