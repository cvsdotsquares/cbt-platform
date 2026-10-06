#!/usr/bin/env bash
set -euo pipefail
export CBT_APP_ROOT="${CBT_APP_ROOT:-/home/cbtplatform/cbt-platform}"
export CBT_API_PORT="${CBT_API_PORT:-5071}"
export CBT_WEB_PORT="${CBT_WEB_PORT:-5070}"
cd "$CBT_APP_ROOT"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
nvm use 24 >/dev/null 2>&1 || nvm use 20 >/dev/null 2>&1 || true
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@9.15.4 --activate

echo "==> pnpm install (with devDependencies for build)"
export CI=1
export NODE_ENV=development
pnpm install --frozen-lockfile --force

echo "==> Build shared + web"
set -a
# shellcheck disable=SC1091
source apps/web/.env.production
set +a
export NODE_ENV=production
pnpm --filter @cbt/shared build
pnpm --filter @cbt/web build

echo "==> FastAPI venv + deps"
python3 -m venv apps/api-fastapi/.venv
apps/api-fastapi/.venv/bin/pip install -q -r apps/api-fastapi/requirements.txt

echo "==> Alembic"
set -a
# shellcheck disable=SC1091
source apps/api-fastapi/.env
set +a
(
  cd apps/api-fastapi
  .venv/bin/alembic upgrade head
)

chmod +x scripts/deploy/start-api-prod.sh
mkdir -p uploads/materials apps/api-fastapi/uploads/materials

echo "==> PM2"
pm2 startOrReload infra/deploy/pm2/ecosystem.cjs --update-env
pm2 save

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:${CBT_API_PORT}/api/v1/health" >/dev/null; then
    echo "==> API healthy on :${CBT_API_PORT}"
    pm2 list
    exit 0
  fi
  sleep 3
done

echo "ERROR: API health failed"
pm2 logs cbt-api --lines 30 --nostream
exit 1
