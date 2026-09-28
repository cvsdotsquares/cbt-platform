#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing dependencies..."
corepack enable
corepack prepare pnpm@9.15.4 --activate
export NODE_OPTIONS="--max-old-space-size=512"
NODE_ENV=development pnpm install --frozen-lockfile

echo "==> Building Web..."
export NODE_OPTIONS="--max-old-space-size=512"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://cbt-api.onrender.com/api/v1}"
export NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-wss://cbt-api.onrender.com}"

pnpm --filter @cbt/shared build
pnpm --filter @cbt/web build

echo "==> Web build complete"
