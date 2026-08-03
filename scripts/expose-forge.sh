#!/usr/bin/env bash
# ============================================================================
# Forge public exposure — zero-config.
#
# Method 1 (default): Cloudflare Quick Tunnel — no account, no config,
#   instant https://xxx.trycloudflare.com URL. Works behind CGNAT/NAT/firewall
#   because the tunnel dials OUT. Perfect for mobile-data-only nodes.
#
# Method 2: Caddy direct bind — when the node has a public IP / open ports.
#
#   bash expose-forge.sh                    # quick tunnel (default)
#   FORGE_EXPOSE=caddy bash expose-forge.sh # direct bind
#
# Env vars:
#   FORGE_PORT   local Forge port (default 3000)
# ============================================================================
set -euo pipefail

FORGE_PORT="${FORGE_PORT:-3000}"
FORGE_EXPOSE="${FORGE_EXPOSE:-tunnel}"

log()  { printf '\033[1;32m[forge]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[forge]\033[0m %s\n' "$*" >&2; exit 1; }

curl -fsS "http://127.0.0.1:$FORGE_PORT" >/dev/null 2>&1 || \
  die "Forge is not answering on :$FORGE_PORT — run bootstrap-forge.sh first"

if [ "$FORGE_EXPOSE" = "caddy" ]; then
  command -v caddy >/dev/null 2>&1 || die "caddy not installed"
  CFG="$(cd "$(dirname "$0")/.." && pwd)/Caddyfile"
  [ -f "$CFG" ] || die "Caddyfile not found at $CFG"
  log "Starting Caddy on :80/:443 (public IP required)"
  exec caddy run --config "$CFG"
fi

# ---------- cloudflared quick tunnel ----------
CF=""
if command -v cloudflared >/dev/null 2>&1; then
  CF="$(command -v cloudflared)"
else
  log "Installing cloudflared ..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64)  CFARCH="amd64" ;;
    aarch64|arm64) CFARCH="arm64" ;;
    armv7l)        CFARCH="arm" ;;
    *) die "Unsupported architecture: $ARCH" ;;
  esac
  DEST="${PREFIX:-$HOME}/bin"
  mkdir -p "$DEST"
  curl -fsSL -o "$DEST/cloudflared" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CFARCH" \
    || die "cloudflared download failed"
  chmod +x "$DEST/cloudflared"
  CF="$DEST/cloudflared"
fi

LOGF="$(mktemp)"
log "Starting Cloudflare Quick Tunnel (ephemeral URL, valid while running)..."
"$CF" tunnel --url "http://127.0.0.1:$FORGE_PORT" >"$LOGF" 2>&1 &
CFPID=$!

URL=""
for _ in $(seq 1 30); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGF" | head -n1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  kill "$CFPID" 2>/dev/null || true
  cat "$LOGF"
  die "Tunnel URL did not appear"
fi

rm -f "$LOGF"
echo
log "Forge is public at:  $URL"
log "(tunnel pid $CFPID — stop with: kill $CFPID)"
echo "$CFPID" > "${HOME}/.forge-tunnel.pid"
wait "$CFPID"
