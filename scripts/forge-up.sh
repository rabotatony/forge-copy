#!/usr/bin/env bash
# ============================================================
# Forge sovereign launcher — one command, zero paid services.
#
#   bash scripts/forge-up.sh
#
# Prefers Docker (isolated, persistent volumes); falls back to
# the native bootstrap (Debian/Ubuntu/Alpine/Termux).
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

log()  { printf '\033[1;32m[forge]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[forge]\033[0m %s\n' "$*"; }

FORGE_PORT="${FORGE_PORT:-3000}"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "Docker detected — building the sovereign Forge image..."
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d --build
  else
    docker build -t forge:latest .
    docker rm -f forge >/dev/null 2>&1 || true
    docker run -d --name forge --restart unless-stopped \
      -p "$FORGE_PORT:3000" \
      -v forge-data:/data -v forge-storage:/app/storage \
      forge:latest
  fi

  log "Waiting for Forge on :$FORGE_PORT ..."
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$FORGE_PORT/api/health" >/dev/null 2>&1; then
      log "OK — Forge is up: http://127.0.0.1:$FORGE_PORT"
      log "Public exposure (free, no account): bash scripts/expose-forge.sh"
      exit 0
    fi
    sleep 2
  done
  warn "Forge is still starting — check: docker logs forge"
  exit 0
fi

log "No Docker — using native bootstrap (git + bun/node + SQLite)"
exec bash scripts/bootstrap-forge.sh
