#!/usr/bin/env bash
# One-shot demo deploy: sync origin/main, bootstrap FastAPI env from legacy Nest .env,
# keep ports 5070/5071 for existing nginx upstreams.
set -euo pipefail

export CBT_APP_ROOT="${CBT_APP_ROOT:-/home/cbtplatform/cbt-platform}"
export CBT_API_PORT="${CBT_API_PORT:-5071}"
export CBT_WEB_PORT="${CBT_WEB_PORT:-5070}"

cd "$CBT_APP_ROOT"

echo "==> Sync main"
git fetch origin main
git checkout -f main
git reset --hard origin/main

NEST_ENV=""
for f in /home/cbtplatform/cbt-app/apps/api/.env \
  /home/cbtplatform/cbt-platform.old-no-git/apps/api/.env \
  /tmp/cbt-deploy-backup-api.env; do
  if [[ -f "$f" ]]; then
    NEST_ENV="$f"
    break
  fi
done

if [[ -z "$NEST_ENV" ]]; then
  echo "ERROR: no Nest .env found to bootstrap FastAPI"
  exit 1
fi

echo "==> Bootstrap apps/api-fastapi/.env"
set -a
# shellcheck disable=SC1090
source "$NEST_ENV"
set +a

DB="${DATABASE_URL:-}"
if [[ "$DB" == postgresql://* ]]; then
  DB="postgresql+psycopg://${DB#postgresql://}"
elif [[ "$DB" == postgres://* ]]; then
  DB="postgresql+psycopg://${DB#postgres://}"
fi

JWT_VAL="${JWT_ACCESS_SECRET:-${JWT_SECRET:-}}"

mkdir -p apps/api-fastapi
cat > apps/api-fastapi/.env <<EOF
ENVIRONMENT=production
APP_URL=https://cbtplatform.24livehost.com
API_PORT=${CBT_API_PORT}
API_HOST=127.0.0.1
DATABASE_URL=${DB}
ASYNC_DATABASE_URL=${DB}
JWT_SECRET=${JWT_VAL}
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_HOURS=3
CORS_ORIGINS=https://cbtplatform.24livehost.com,https://cbtplatform-backend.24livehost.com
UPLOAD_DIR=./uploads/materials
OPENAI_API_KEY=${OPENAI_API_KEY:-}
OPENAI_BASE_URL=${OPENAI_BASE_URL:-https://api.openai.com/v1}
OPENAI_MODEL=${OPENAI_MODEL:-gpt-4o-mini}
EOF

if [[ -f apps/web/.env.production ]] && grep -q '127.0.0.1:4010' apps/web/.env.production; then
  sed -i 's|127.0.0.1:4010|127.0.0.1:5071|g' apps/web/.env.production
fi

chmod +x scripts/deploy/*.sh

echo "==> Stop legacy PM2 apps"
pm2 delete cbt-production-api cbt-production-web 2>/dev/null || true

echo "==> Deploy"
./scripts/deploy/deploy.sh

echo "==> PM2"
pm2 list
