#!/usr/bin/env bash
# Start (or restart) CBT demo on ports 5070 (web) / 5071 (api) for nginx upstreams.
# Run on the server after code + env files exist. Does not rebuild.
set -euo pipefail

export CBT_APP_ROOT="${CBT_APP_ROOT:-/home/cbtplatform/cbt-platform}"
export CBT_API_PORT="${CBT_API_PORT:-5071}"
export CBT_WEB_PORT="${CBT_WEB_PORT:-5070}"

cd "$CBT_APP_ROOT"

if [[ ! -f apps/api-fastapi/.env ]]; then
  echo "ERROR: missing apps/api-fastapi/.env — configure env first (see infra/deploy/env/api.env.example)"
  exit 1
fi
if [[ ! -f apps/web/.env.production ]]; then
  echo "ERROR: missing apps/web/.env.production"
  exit 1
fi
if [[ ! -d apps/api-fastapi/.venv ]]; then
  echo "ERROR: missing apps/api-fastapi/.venv — run ./scripts/deploy/deploy.sh or demo-finish-deploy.sh once"
  exit 1
fi
if [[ ! -d apps/web/.next ]]; then
  echo "ERROR: missing apps/web/.next — run a production build first"
  exit 1
fi

# Ensure API .env port matches PM2 (start-api-prod.sh reads API_PORT from .env)
if grep -q '^API_PORT=' apps/api-fastapi/.env; then
  sed -i "s/^API_PORT=.*/API_PORT=${CBT_API_PORT}/" apps/api-fastapi/.env
else
  echo "API_PORT=${CBT_API_PORT}" >> apps/api-fastapi/.env
fi

chmod +x scripts/deploy/start-api-prod.sh

echo "==> PM2 start/reload (web :${CBT_WEB_PORT}, api :${CBT_API_PORT})"
pm2 startOrReload infra/deploy/pm2/ecosystem.cjs --update-env
pm2 save

echo "==> Listening ports"
ss -tlnp 2>/dev/null | grep -E ":${CBT_WEB_PORT}|:${CBT_API_PORT}" || true

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:${CBT_API_PORT}/api/v1/health" >/dev/null; then
    echo "==> API healthy on 127.0.0.1:${CBT_API_PORT}"
    pm2 list
    exit 0
  fi
  sleep 2
done

echo "ERROR: API not healthy — run: pm2 logs cbt-api --lines 50"
exit 1
