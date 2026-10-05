#!/usr/bin/env bash
# Non-Docker deploy for CBT Platform on a company Linux server.
# Usage (from repo root on the server):
#   ./scripts/deploy/deploy.sh
#
# Expects env files already present (not in git):
#   apps/api-fastapi/.env
#   apps/web/.env.production   (NEXT_PUBLIC_* used at build time)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export CBT_APP_ROOT="$ROOT_DIR"

ECOSYSTEM="infra/deploy/pm2/ecosystem.cjs"
if [[ ! -f "$ECOSYSTEM" ]]; then
  echo "ERROR: missing $ECOSYSTEM"
  exit 1
fi

echo "==> Deploying CBT from $ROOT_DIR"

API_ENV="apps/api-fastapi/.env"
if [[ ! -f "$API_ENV" ]]; then
  echo "ERROR: $API_ENV missing. Copy infra/deploy/env/api.env.example → $API_ENV"
  exit 1
fi
if [[ ! -f apps/web/.env.production ]]; then
  echo "ERROR: apps/web/.env.production missing. Copy infra/deploy/env/web.env.example → apps/web/.env.production"
  exit 1
fi

export NODE_ENV=production

# Load public build-time vars for Next.js
set -a
# shellcheck disable=SC1091
source apps/web/.env.production
set +a

echo "==> Installing Node dependencies"
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile

echo "==> Building shared + Web"
pnpm --filter @cbt/shared build
pnpm --filter @cbt/web build

echo "==> Python API (FastAPI)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found. Install Python 3.11+ on the server."
  exit 1
fi

python3 -m venv apps/api-fastapi/.venv
apps/api-fastapi/.venv/bin/pip install -q -r apps/api-fastapi/requirements.txt

echo "==> Running Alembic migrations"
set -a
# shellcheck disable=SC1091
source "$API_ENV"
set +a
(
  cd apps/api-fastapi
  .venv/bin/alembic upgrade head
)

chmod +x scripts/deploy/start-api-prod.sh

echo "==> Ensuring upload directory exists"
mkdir -p uploads/materials
mkdir -p apps/api-fastapi/uploads/materials

echo "==> Reloading PM2 ($ECOSYSTEM)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload "$ECOSYSTEM" --update-env
  pm2 save
else
  echo "WARNING: pm2 not found. Install with: npm i -g pm2"
  echo "Then run: pm2 start $ECOSYSTEM && pm2 save"
fi

echo "==> Smoke check (local)"
API_PORT="${CBT_API_PORT:-4010}"

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:${API_PORT}/api/v1/health" >/dev/null; then
    echo "==> API healthy on :${API_PORT}"
    echo "==> Deploy complete"
    exit 0
  fi
  sleep 3
done

echo "WARNING: API health check did not pass yet — check: pm2 logs cbt-api"
exit 0
