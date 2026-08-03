#!/usr/bin/env bash
# Forge Codespace start — boots the dev server if not already running.
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"
export DATABASE_URL="file:$(pwd)/storage/forge.db"

# Only start if nothing is listening on 3000 yet.
if ! curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
  echo '[start] launching Forge on :3000...'
  nohup bun run dev > storage/forge-dev.log 2>&1 &
  echo $! > storage/forge.pid
else
  echo '[start] Forge already running on :3000.'
fi
