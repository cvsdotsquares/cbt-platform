#!/usr/bin/env bash
# Run ON the production server as the deploy user (e.g. cbtplatform).
# Pins production to ~/cbt-platform and stops PM2 from using ~/cbt-app.
#
# Usage:
#   cd ~/cbt-platform && bash scripts/deploy/server-retire-cbt-app.sh
set -euo pipefail

CANONICAL="${CBT_APP_ROOT:-$HOME/cbt-platform}"
LEGACY="${CBT_LEGACY_APP_ROOT:-$HOME/cbt-app}"

echo "==> Canonical checkout: $CANONICAL"
echo "==> Legacy checkout:    $LEGACY"

if [[ ! -f "$CANONICAL/scripts/deploy/remote-deploy.sh" ]]; then
  echo "ERROR: $CANONICAL does not look like the CBT repo root"
  exit 1
fi

export CBT_APP_ROOT="$CANONICAL"

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Removing PM2 processes (recreated on next deploy from $CANONICAL)"
  pm2 delete cbt-api cbt-web 2>/dev/null || true
  pm2 save 2>/dev/null || true
fi

mkdir -p "$CANONICAL/apps/api-fastapi"
mkdir -p "$CANONICAL/apps/web"

if [[ ! -f "$CANONICAL/apps/api-fastapi/.env" ]]; then
  if [[ -f "$CANONICAL/infra/deploy/env/api.env.example" ]]; then
    cp "$CANONICAL/infra/deploy/env/api.env.example" "$CANONICAL/apps/api-fastapi/.env"
    echo "==> Created apps/api-fastapi/.env from example — edit DATABASE_URL, JWT_SECRET, APP_URL"
  elif [[ -f "$LEGACY/apps/api/.env" ]]; then
    echo "==> WARNING: Found Nest env at $LEGACY/apps/api/.env"
    echo "    Map values manually to $CANONICAL/apps/api-fastapi/.env (see infra/deploy/env/api.env.example)"
  fi
fi

if [[ ! -f "$CANONICAL/apps/web/.env.production" ]]; then
  if [[ -f "$LEGACY/apps/web/.env.production" ]]; then
    cp "$LEGACY/apps/web/.env.production" "$CANONICAL/apps/web/.env.production"
    echo "==> Copied apps/web/.env.production from legacy clone"
  elif [[ -f "$CANONICAL/infra/deploy/env/web.env.example" ]]; then
    cp "$CANONICAL/infra/deploy/env/web.env.example" "$CANONICAL/apps/web/.env.production"
    echo "==> Created apps/web/.env.production from example — edit NEXT_PUBLIC_* and API_PROXY_URL"
  fi
fi

if [[ -d "$LEGACY" && "$LEGACY" != "$CANONICAL" ]]; then
  STAMP="$(date +%Y%m%d)"
  RETIRED="${LEGACY}.retired.${STAMP}"
  echo "==> To retire the old clone: mv $LEGACY $RETIRED"
fi

echo ""
echo "==> GitHub Actions: set secret DEPLOY_PATH=$CANONICAL"
echo "==> PM2 + nginx must proxy to ports 4010 (API) and 3010 (Web) from this tree only"
echo "==> Deploy: cd $CANONICAL && git pull && ./scripts/deploy/deploy.sh"
