#!/usr/bin/env bash
set -euo pipefail

cd apps/api

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=460}"

if [ "${SKIP_MIGRATE_ON_BOOT:-}" != "1" ]; then
  echo "==> Waiting for database and applying migrations..."
  for attempt in 1 2 3 4 5; do
    if npx prisma migrate deploy; then
      echo "==> Migrations OK"
      break
    fi
    if [ "$attempt" -eq 5 ]; then
      echo "==> Migrations failed after 5 attempts — check DATABASE_URL and cbt-db status on Render"
      exit 1
    fi
    wait=$((attempt * 5))
    echo "==> Migration attempt ${attempt} failed (DB may be waking). Retrying in ${wait}s..."
    sleep "$wait"
  done
else
  echo "==> Skipping migrations (SKIP_MIGRATE_ON_BOOT=1)"
fi

echo "==> Starting API on port ${PORT:-4000}..."
exec node dist/src/main.js
