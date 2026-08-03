#!/usr/bin/env bash
# ============================================================
# Forge Mesh — one-command node bootstrap.
# Turns any Linux box or Android/Termux device into a Forge
# node. No root, no inbound ports, no credit card, no vendor.
#
# Usage:
#   FORGE_URL=https://your-forge.example.com \
#   NODE_SLUG=my-node \
#   NODE_SECRET=xxxx \
#   bash bootstrap-node.sh [--foreground]
#
# Or self-download from a running Forge:
#   FORGE_URL=... NODE_SLUG=... NODE_SECRET=... \
#     bash <(curl -fsSL $FORGE_URL/mesh/bootstrap-node.sh)
# ============================================================
set -eu

command -v curl >/dev/null 2>&1 || { echo "curl is required"; exit 1; }

# --- detect environment ---
ENV_KIND="linux"
if [ -n "${PREFIX:-}" ]; then
  case "$PREFIX" in *com.termux*) ENV_KIND="termux" ;; esac
fi
echo "[forge-bootstrap] environment: $ENV_KIND"

# --- install deps ---
if [ "$ENV_KIND" = "termux" ]; then
  command -v jq >/dev/null 2>&1 || pkg install -y jq
  command -v tar >/dev/null 2>&1 || pkg install -y tar
else
  if command -v apt-get >/dev/null 2>&1; then
    command -v jq >/dev/null 2>&1 || sudo apt-get install -y jq 2>/dev/null || apt-get install -y jq 2>/dev/null || true
  elif command -v apk >/dev/null 2>&1; then
    command -v jq >/dev/null 2>&1 || apk add --no-cache jq 2>/dev/null || true
  fi
fi
command -v jq >/dev/null 2>&1 || { echo "jq is required — install it manually"; exit 1; }

# --- fetch agent ---
FORGE_URL="${FORGE_URL:?set FORGE_URL}"
FORGE_URL="${FORGE_URL%/}"
NODE_DIR="$HOME/.forge-node"
mkdir -p "$NODE_DIR"

echo "[forge-bootstrap] downloading agent from $FORGE_URL/mesh/agent.sh ..."
if ! curl -fsSL "$FORGE_URL/mesh/agent.sh" -o "$NODE_DIR/agent.sh"; then
  echo "Could not fetch agent. If Forge is not reachable yet, copy"
  echo "public/mesh/agent.sh from the repository to $NODE_DIR/agent.sh"
  echo "and run it manually with agent.env exported."
  exit 1
fi
chmod +x "$NODE_DIR/agent.sh"

# --- persist env (secret file — locked permissions) ---
umask 077
cat > "$NODE_DIR/agent.env" <<EOF
FORGE_URL=$FORGE_URL
NODE_SLUG=${NODE_SLUG:?set NODE_SLUG}
NODE_SECRET=${NODE_SECRET:?set NODE_SECRET}
FORGE_PUBLISH_DIR=${FORGE_PUBLISH_DIR:-$NODE_DIR/sites}
EOF

# --- keepalive boot script ---
printf '#!/usr/bin/env bash\nset -a; . %s/agent.env; set +a\nexec bash %s/agent.sh\n' "$NODE_DIR" "$NODE_DIR" > "$NODE_DIR/boot.sh"
chmod +x "$NODE_DIR/boot.sh"

if [ "${1:-}" = "--foreground" ]; then
  set -a; . "$NODE_DIR/agent.env"; set +a
  exec bash "$NODE_DIR/agent.sh"
fi

# --- launch in background, resilient to logout ---
nohup bash -c 'set -a; . "$HOME/.forge-node/agent.env"; set +a; exec bash "$HOME/.forge-node/agent.sh"' \
  >> "$NODE_DIR/agent.log" 2>&1 &
AGENT_PID=$!
echo "[forge-bootstrap] agent started (pid $AGENT_PID)"
echo "[forge-bootstrap] logs: $NODE_DIR/agent.log"
echo
echo "Keep the node alive after reboot:"
if [ "$ENV_KIND" = "termux" ]; then
  echo "  * Run: termux-wake-lock"
  echo "  * Install Termux:Boot and call $NODE_DIR/boot.sh from ~/.termux/boot/"
else
  echo "  * Add an @reboot cron entry:"
  echo "      (crontab -l 2>/dev/null; echo '@reboot $NODE_DIR/boot.sh >> $NODE_DIR/agent.log 2>&1 &') | crontab -"
fi
