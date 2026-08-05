#!/bin/sh
# ============================================================
# Forge container entrypoint
# 1. Sync the SQLite schema (idempotent — safe on every boot)
# 2. Start the standalone Next.js server
# ============================================================
set -e
cd /app

mkdir -p /data /app/storage

echo "[forge] syncing database schema..."
bunx prisma db push --accept-data-loss --skip-generate >/dev/null 2>&1 || \
  echo "[forge] WARNING: prisma db push failed — starting anyway"

echo "[forge] starting Forge on :${PORT:-3000}"
exec bun .next/standalone/server.js
