#!/usr/bin/env bash
# Deploy CBT Platform to a Linux VPS with Docker Compose.
# Usage: ./infra/docker/deploy.sh [your-domain.com]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/infra/docker/.env.production"
COMPOSE="docker compose -f $ROOT/infra/docker/docker-compose.prod.yml --env-file $ENV_FILE"

DOMAIN="${1:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE from example..."
  cp "$ROOT/infra/docker/.env.production.example" "$ENV_FILE"
  echo "Edit $ENV_FILE with your domain and secrets, then re-run."
  exit 1
fi

if [[ -n "$DOMAIN" ]]; then
  sed -i "s|cbt.yourdomain.com|$DOMAIN|g" "$ENV_FILE"
  echo "Updated domain to $DOMAIN in .env.production"
fi

echo "Building images..."
$COMPOSE build

echo "Starting services..."
$COMPOSE up -d

echo "Waiting for API to be healthy..."
sleep 15

echo "Seeding database (safe to re-run)..."
$COMPOSE run --rm api npx prisma db seed || true

echo ""
echo "Deployment complete!"
echo "  App:  http://$(grep APP_URL "$ENV_FILE" | cut -d= -f2 | sed 's|https://||')"
echo "  Logs: pnpm docker:prod:logs"
echo ""
echo "Next: point DNS to this server and add HTTPS (certbot or Cloudflare)."
