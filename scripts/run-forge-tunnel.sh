#!/usr/bin/env bash
# ============================================================
# Forge — run locally + expose via Cloudflare Tunnel
# ============================================================
# Runs the Forge control plane on THIS machine (Node.js + SQLite +
# filesystem) and exposes it publicly through a Cloudflare Tunnel.
# No credit card, no VPS, no ports to open — the tunnel dials out.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=cfut_xxx  ./scripts/run-forge-tunnel.sh
#   (optional) FORGE_PORT=3000  TUNNEL_NAME=forge
# ============================================================
set -euo pipefail

FORGE_PORT="${FORGE_PORT:-3000}"
TUNNEL_NAME="${TUNNEL_NAME:-forge}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo 'ERROR: set CLOUDFLARE_API_TOKEN (your cfut_... token).' >&2
  exit 1
fi

cd "$(dirname "$0")/.."   # repo root
echo "[forge] repo root: $(pwd)"

# ---------- 1. runtime + deps ----------
if ! command -v bun >/dev/null 2>&1; then
  echo '[forge] bun not found — install from https://bun.sh first' >&2
  exit 1
fi
echo '[forge] installing dependencies...'
bun install --frozen-lockfile

# ---------- 2. database ----------
export DATABASE_URL="${DATABASE_URL:-file:./storage/forge.db}"
echo '[forge] prisma db push...'
bunx prisma db push --skip-generate || bunx prisma generate
bunx prisma generate

# ---------- 3. build ----------
echo '[forge] building (next build)...'
bun run build

# ---------- 4. start Forge in background ----------
mkdir -p storage
echo "[forge] starting Forge on :${FORGE_PORT} ..."
PORT="$FORGE_PORT" bun run start > storage/forge-server.log 2>&1 &
FORGE_PID=$!
echo "[forge] server pid: $FORGE_PID"

# wait for it to answer
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${FORGE_PORT}/api/health" >/dev/null 2>&1 \
     || curl -fsS "http://127.0.0.1:${FORGE_PORT}/" >/dev/null 2>&1; then
    echo '[forge] Forge is up.'
    break
  fi
  sleep 2
done

# ---------- 5. cloudflared ----------
if ! command -v cloudflared >/dev/null 2>&1; then
  echo '[forge] installing cloudflared...'
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64)  CFARCH=amd64 ;;
    aarch64|arm64) CFARCH=arm64 ;;
    *) CFARCH=amd64 ;;
  esac
  curl -fsSL -o /usr/local/bin/cloudflared \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CFARCH}" \
    || curl -fsSL -o ./cloudflared \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CFARCH}"
  chmod +x /usr/local/bin/cloudflared 2>/dev/null || chmod +x ./cloudflared
fi
CLOUDFLARED=$(command -v cloudflared || echo ./cloudflared)

# ---------- 6. quick tunnel (no pre-created tunnel needed) ----------
echo '[forge] starting Cloudflare quick tunnel...'
export CLOUDFLARE_API_TOKEN
"$CLOUDFLARED" tunnel --url "http://127.0.0.1:${FORGE_PORT}" > storage/tunnel.log 2>&1 &
TUNNEL_PID=$!
echo "[forge] tunnel pid: $TUNNEL_PID"

# ---------- 7. report the public URL ----------
sleep 5
PUBLIC_URL=$(grep -oE 'https://[a-z0-9.-]+\.trycloudflare\.com' storage/tunnel.log | head -n1 || true)
if [ -n "$PUBLIC_URL" ]; then
  echo ''
  echo '=========================================================='
  echo "  Forge is public at:  $PUBLIC_URL"
  echo "  Set this as your GitHub webhook base:"
  echo "    $PUBLIC_URL/api/forge/webhooks/github"
  echo '=========================================================='
else
  echo '[forge] tunnel URL not detected yet — check storage/tunnel.log'
fi

echo ''
echo '[forge] Forge pid:' $FORGE_PID ' | Tunnel pid:' $TUNNEL_PID
echo '[forge] logs: storage/forge-server.log, storage/tunnel.log'
echo '[forge] Ctrl-C to stop both, or:'
echo '   kill' $FORGE_PID $TUNNEL_PID

# keep script alive so both background processes stay up
wait
