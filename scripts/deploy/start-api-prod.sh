#!/usr/bin/env bash
# PM2 entrypoint: load FastAPI env and run uvicorn (production).
set -euo pipefail

ROOT="${CBT_APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
API_DIR="$ROOT/apps/api-fastapi"
ENV_FILE="$API_DIR/.env"
VENV="$API_DIR/.venv"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

PORT="${API_PORT:-4010}"
HOST="${API_HOST:-127.0.0.1}"

cd "$API_DIR"
exec "$VENV/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT" --loop asyncio
