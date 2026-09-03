#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing dependencies..."
corepack enable
corepack prepare pnpm@9.15.4 --activate
export NODE_OPTIONS="--max-old-space-size=512"
NODE_ENV=development pnpm install --frozen-lockfile

echo "==> Building API..."
pnpm --filter @cbt/shared build
pnpm --filter @cbt/api prisma:generate
pnpm --filter @cbt/api build

echo "==> API build complete"
