#!/usr/bin/env bash
# Run on the server (via SSH from GitHub Actions).
# Usage:
#   ./scripts/deploy/remote-deploy.sh [git-ref]
#
# Placeholders (set by CI or server admin):
#   CBT_APP_ROOT — absolute path to the git checkout
set -euo pipefail

GIT_REF="${1:-}"

ROOT="${CBT_APP_ROOT:-}"
if [[ -z "$ROOT" ]]; then
  echo "ERROR: set CBT_APP_ROOT to the app checkout path (e.g. /home/cbtplatform/cbt-platform)"
  exit 1
fi

cd "$ROOT"

echo "==> Fetching latest in $ROOT"
git fetch --all --prune --tags

if [[ -n "$GIT_REF" ]]; then
  echo "==> Checking out $GIT_REF"
  git checkout --force -B deploy/main "$GIT_REF"
else
  echo "==> Checking out main"
  git checkout --force main
  git reset --hard origin/main
fi

chmod +x scripts/deploy/deploy.sh scripts/deploy/remote-deploy.sh scripts/deploy/start-api-prod.sh scripts/deploy/server-retire-cbt-app.sh
./scripts/deploy/deploy.sh
