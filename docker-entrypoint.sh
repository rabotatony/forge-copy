#!/bin/sh
# ============================================================
# Forge container entrypoint
# 1. Sync the SQLite schema (idempotent — safe on every boot)
# 2. Start the standalone Next.js server
# ============================================================
set -e
cd /app

mkdir -p /data /app/storage

# Encryption key: generate + persist on first boot if not provided
if [ -z "$FORGE_ENCRYPTION_KEY" ] || [ "$FORGE_ENCRYPTION_KEY" = "buildplaceholder0000000000000000" ]; then
  if [ -f /data/.forge-key ]; then
    export FORGE_ENCRYPTION_KEY="$(cat /data/.forge-key)"
  else
    export FORGE_ENCRYPTION_KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d " \n")"
    echo "$FORGE_ENCRYPTION_KEY" > /data/.forge-key
  fi
fi

echo "[forge] syncing database schema..."
bunx prisma db push --accept-data-loss --skip-generate >/dev/null 2>&1 || \
  echo "[forge] WARNING: prisma db push failed — starting anyway"

echo "[forge] starting Forge on :${PORT:-3000}"
exec bun .next/standalone/server.js
