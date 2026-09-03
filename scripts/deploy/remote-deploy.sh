#!/usr/bin/env bash
# Run on the server (via SSH from GitHub Actions).
# Usage:
#   ./scripts/deploy/remote-deploy.sh <dev|staging|production> [git-ref]
#
# Placeholders (set by CI or server admin):
#   CBT_APP_ROOT — absolute path to this env's git checkout
set -euo pipefail

ENV_NAME="${1:-}"
GIT_REF="${2:-}"

if [[ -z "$ENV_NAME" || ! "$ENV_NAME" =~ ^(dev|staging|production)$ ]]; then
  echo "Usage: $0 <dev|staging|production> [git-ref]"
  exit 1
fi

ROOT="${CBT_APP_ROOT:-}"
if [[ -z "$ROOT" ]]; then
  echo "ERROR: set CBT_APP_ROOT to the env checkout path (e.g. /var/www/cbt/staging)"
  exit 1
fi

cd "$ROOT"

echo "==> Fetching latest in $ROOT"
git fetch --all --prune --tags

if [[ -n "$GIT_REF" ]]; then
  echo "==> Checking out $GIT_REF"
  git checkout --force -B "deploy/${ENV_NAME}" "$GIT_REF"
else
  case "$ENV_NAME" in
    dev) BRANCH=dev ;;
    staging) BRANCH=develop ;;
    production) BRANCH=main ;;
  esac
  echo "==> Checking out $BRANCH"
  git checkout --force "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

chmod +x scripts/deploy/deploy.sh scripts/deploy/remote-deploy.sh
./scripts/deploy/deploy.sh "$ENV_NAME"
