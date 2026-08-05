#!/usr/bin/env bash
# ============================================================
# Forge sovereign launcher — one command, zero paid services.
#
#   bash scripts/forge-up.sh            # provision envs + start Forge
#   bash scripts/forge-up.sh env        # only provision missing environments
#   bash scripts/forge-up.sh status     # health check
#   bash scripts/forge-up.sh logs       # tail logs
#   bash scripts/forge-up.sh stop       # stop Forge
#
# `up` first provisions every runtime Forge needs (forge-env.sh:
# bun, node, python3+uv, docker), then starts Forge:
#   - Docker path  -> compose container, restart-policy = auto-start
#                     on boot, docker daemon enabled via systemd.
#   - Native path  -> bootstrap-forge.sh installs systemd unit
#                     forge.service (Restart=always, enabled).
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

log()  { printf '\033[1;32m[forge]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[forge]\033[0m %s\n' "$*"; }

FORGE_PORT="${FORGE_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:$FORGE_PORT/api/health"

docker_running() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

compose_ok() {
  docker compose version >/dev/null 2>&1
}

forge_container_exists() {
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx forge
}

wait_up() {
  log "Waiting for Forge on :$FORGE_PORT ..."
  for _ in $(seq 1 45); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      log "OK — Forge is up: http://127.0.0.1:$FORGE_PORT"
      log "Auto-start: configured (restart policy / systemd)."
      log "Public exposure (free, no account): bash scripts/expose-forge.sh"
      return 0
    fi
    sleep 2
  done
  warn "Forge is still starting — check: bash scripts/forge-up.sh logs"
}

cmd="${1:-up}"
case "$cmd" in

  env)
    exec bash scripts/forge-env.sh
    ;;

  status)
    rc=0
    if forge_container_exists; then
      docker ps -a --filter name=forge --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
    elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^forge\.service'; then
      systemctl is-active forge 2>/dev/null || true
    fi
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      log "health: OK — $HEALTH_URL"
      curl -s "$HEALTH_URL" 2>/dev/null | head -c 400 || true
      echo
    else
      warn "health: NOT responding on $HEALTH_URL"
      rc=1
    fi
    exit $rc
    ;;

  logs)
    if forge_container_exists; then
      exec docker logs -f --tail 200 forge
    elif [ -f "$HOME/forge/.forge/forge.log" ]; then
      exec tail -f "$HOME/forge/.forge/forge.log"
    elif command -v journalctl >/dev/null 2>&1; then
      exec journalctl -u forge -f --no-pager
    else
      warn "no known log location (docker container 'forge', ~/forge/.forge/forge.log or journalctl -u forge)"
      exit 1
    fi
    ;;

  stop)
    if compose_ok && [ -f docker-compose.yml ] && forge_container_exists; then
      docker compose down
    elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^forge\.service'; then
      ${SUDO:-sudo} systemctl stop forge 2>/dev/null || sudo systemctl stop forge
    else
      pkill -f ".next/standalone/server.js" 2>/dev/null || true
      pkill -f "next-server" 2>/dev/null || true
    fi
    log "Forge stopped"
    ;;

  up)
    # 1. Provision missing environments (idempotent, best effort)
    log "Step 1/3 — provisioning environments"
    bash scripts/forge-env.sh || warn "forge-env.sh reported issues (continuing)"
    export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

    # 2. Start Forge — prefer Docker, fall back to native
    if docker_running; then
      log "Step 2/3 — Docker path (persistent volumes, auto-restart on boot)"
      if compose_ok; then
        docker compose up -d --build
      else
        docker build -t forge:latest .
        docker rm -f forge >/dev/null 2>&1 || true
        docker run -d --name forge --restart unless-stopped \
          -p "$FORGE_PORT:3000" \
          -v forge-data:/data -v forge-storage:/app/storage \
          forge:latest
      fi
      # auto-start on boot: make sure the docker daemon itself is enabled
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl enable docker >/dev/null 2>&1 || true
      fi
      log "Step 3/3 — health check"
      wait_up
    else
      log "Step 2/3 — no Docker: native bootstrap (systemd auto-start where available)"
      exec bash scripts/bootstrap-forge.sh
    fi
    ;;

  *)
    echo "Usage: bash scripts/forge-up.sh [up|env|status|logs|stop]"
    exit 1
    ;;
esac
