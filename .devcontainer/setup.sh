#!/usr/bin/env bash
# Forge Codespace setup — installs bun, deps, and initializes the SQLite DB.
set -e
cd "$(dirname "$0")/.."

echo '[setup] installing bun...'
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash || npm install -g bun
  export PATH="$HOME/.bun/bin:$PATH"
fi

echo '[setup] installing dependencies...'
bun install || npm install

echo '[setup] initializing database...'
mkdir -p storage
export DATABASE_URL="file:$(pwd)/storage/forge.db"
bunx prisma db push --skip-generate || bunx prisma generate

echo '[setup] done.'
