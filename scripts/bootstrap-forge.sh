#!/usr/bin/env bash
# ============================================================================
# Forge Node Bootstrap (Phase A) — one command to a fully working Forge.
#
# Works on: Debian/Ubuntu, Fedora, Alpine, and Termux (Android — no root).
# Zero-config: installs toolchain, clones Forge, creates the SQLite DB,
# builds the production bundle and starts it (systemd where available).
#
#   bash bootstrap-forge.sh
#
# Optional env vars:
#   FORGE_REPO   repo to clone        (default: rabotatony/forge-copy)
#   FORGE_DIR    install dir          (default: ~/forge)
#   FORGE_PORT   http port            (default: 3000)
#   FORGE_DEV    1 = run dev mode     (default: 0 = production build)
# ============================================================================
set -euo pipefail

FORGE_REPO="${FORGE_REPO:-https://github.com/rabotatony/forge-copy}"
FORGE_DIR="${FORGE_DIR:-$HOME/forge}"
FORGE_PORT="${FORGE_PORT:-3000}"
FORGE_DEV="${FORGE_DEV:-0}"

log()  { printf '\033[1;32m[forge]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[forge]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[forge]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- environment detection --------------------------------------------------
IS_TERMUX=0
if [ -n "${PREFIX:-}" ]; then case "$PREFIX" in *com.termux*) IS_TERMUX=1 ;; esac; fi

RUNNER=""
pick_runner() {
  if command -v bun >/dev/null 2>&1; then RUNNER="bun"; return; fi
  if command -v node >/dev/null 2>&1; then RUNNER="node"; return; fi
}

# ---- 1. base packages --------------------------------------------------------
log "Step 1/7 — base packages"
if [ "$IS_TERMUX" = "1" ]; then
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y git curl >/dev/null 2>&1 || die "pkg install git curl failed"
  pkg install -y nodejs-lts >/dev/null 2>&1 || pkg install -y nodejs >/dev/null 2>&1 || true
else
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y >/dev/null
    sudo apt-get install -y git curl unzip ca-certificates >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git curl unzip ca-certificates >/dev/null
  elif command -v apk >/dev/null 2>&1; then
    sudo apk add --no-cache git curl unzip ca-certificates >/dev/null
  else
    warn "Unknown package manager — assuming git/curl already present"
  fi
fi
command -v git >/dev/null 2>&1 || die "git is required"

# ---- 2. runtime (bun, else node) ---------------------------------------------
log "Step 2/7 — runtime"
if ! command -v bun >/dev/null 2>&1 && [ "$IS_TERMUX" != "1" ]; then
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || warn "bun installer failed"
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
pick_runner
[ -n "$RUNNER" ] || die "Neither bun nor node could be installed"
log "Using runner: $RUNNER ($($RUNNER --version 2>/dev/null | head -n1))"

PKGRUN="$RUNNER"
if [ "$RUNNER" = "node" ]; then
  command -v npx >/dev/null 2>&1 || die "npx is required with node"
  PKGRUN="npx --yes"
fi

# ---- 3. clone ------------------------------------------------------------------
log "Step 3/7 — source"
if [ -d "$FORGE_DIR/.git" ]; then
  git -C "$FORGE_DIR" pull --ff-only
else
  git clone --depth 1 "$FORGE_REPO" "$FORGE_DIR"
fi
cd "$FORGE_DIR"

# ---- 4. environment file ---------------------------------------------------------
log "Step 4/7 — environment"
mkdir -p "$FORGE_DIR/.forge"
DB_PATH="$FORGE_DIR/.forge/forge.db"
cat > "$FORGE_DIR/.forge/env.sh" <<EOF
export DATABASE_URL="file:$DB_PATH"
export PORT="$FORGE_PORT"
export NODE_ENV=production
EOF
cat > "$FORGE_DIR/.env" <<EOF
DATABASE_URL="file:$DB_PATH"
PORT=$FORGE_PORT
EOF

# ---- 5. dependencies + database ----------------------------------------------------
log "Step 5/7 — install + database"
if [ "$RUNNER" = "bun" ]; then
  bun install
  bun run db:push
else
  npm install --no-audit --no-fund
  $PKGRUN prisma db push --accept-data-loss
fi

# ---- 6. build ------------------------------------------------------------------------
log "Step 6/7 — build"
if [ "$FORGE_DEV" = "1" ]; then
  warn "FORGE_DEV=1 — skipping production build"
else
  if [ "$RUNNER" = "bun" ]; then bun run build; else npm run build; fi
fi

# ---- 7. start ----------------------------------------------------------------------------
log "Step 7/7 — start"
start_cmd_prod() {
  if command -v bun >/dev/null 2>&1; then
    NODE_ENV=production PORT="$FORGE_PORT" DATABASE_URL="file:$DB_PATH" bun .next/standalone/server.js
  else
    NODE_ENV=production PORT="$FORGE_PORT" DATABASE_URL="file:$DB_PATH" node .next/standalone/server.js
  fi
}

if [ "$IS_TERMUX" = "1" ]; then
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
  pkill -f ".next/standalone/server.js" 2>/dev/null || true
  if [ "$FORGE_DEV" = "1" ]; then
    nohup bash -c "cd $FORGE_DIR && (bun run dev 2>/dev/null || npm run dev)" > "$FORGE_DIR/.forge/forge.log" 2>&1 &
  else
    nohup bash -c "$(declare -f start_cmd_prod); cd $FORGE_DIR && start_cmd_prod" > "$FORGE_DIR/.forge/forge.log" 2>&1 &
  fi
  echo $! > "$FORGE_DIR/.forge/forge.pid"
  log "Running in background (pid $(cat "$FORGE_DIR/.forge/forge.pid")), log: $FORGE_DIR/.forge/forge.log"
elif command -v systemctl >/dev/null 2>&1 && [ "$FORGE_DEV" != "1" ]; then
  if [ "$RUNNER" = "bun" ]; then
    RUN_BIN="$(command -v bun)"
  else
    RUN_BIN="$(command -v node)"
  fi
  sudo tee /etc/systemd/system/forge.service >/dev/null <<EOF
[Unit]
Description=Forge — self-hosted CI/CD control plane
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$FORGE_DIR
EnvironmentFile=$FORGE_DIR/.forge/env.sh
ExecStart=$RUN_BIN .next/standalone/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now forge
  log "systemd service 'forge' installed and started"
else
  warn "No systemd — background mode"
  pkill -f ".next/standalone/server.js" 2>/dev/null || true
  nohup bash -c "$(declare -f start_cmd_prod); cd $FORGE_DIR && start_cmd_prod" > "$FORGE_DIR/.forge/forge.log" 2>&1 &
  echo $! > "$FORGE_DIR/.forge/forge.pid"
fi

# ---- health check --------------------------------------------------------------------------
log "Waiting for Forge on :$FORGE_PORT ..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$FORGE_PORT" >/dev/null 2>&1; then
    log "OK — Forge is up: http://127.0.0.1:$FORGE_PORT"
    log "Next: public exposure -> bash scripts/expose-forge.sh"
    exit 0
  fi
  sleep 2
done
warn "Forge did not answer within 60s — check $FORGE_DIR/.forge/forge.log"
exit 1
