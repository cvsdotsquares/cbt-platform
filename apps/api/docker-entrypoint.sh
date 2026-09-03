#!/bin/sh
set -e
echo "Running database migrations..."
npx prisma migrate deploy
echo "Starting API server..."
exec node dist/src/main.js
