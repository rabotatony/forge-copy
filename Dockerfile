# ============================================================
# Forge — sovereign self-hosted CI/CD
# Runs anywhere Docker runs: VPS, home server, Raspberry Pi.
# No Cloudflare, no paid plans — Node + SQLite + local filesystem.
#
#   docker compose up -d --build        (recommended)
#   bash scripts/forge-up.sh            (auto-detects Docker)
# ============================================================
FROM node:22-slim

WORKDIR /app

# Toolchain needed for building and for Forge's own build engine
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends git curl ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g bun

# Sovereign runtime config: SQLite on a persistent volume.
# FORGE_BUILD_TARGET is NOT set -> next build emits .next/standalone.
ENV DATABASE_URL="file:/data/forge.db" \
    FORGE_SITES_ROOT=/data/sites \
    PORT=3000

# Dependencies (layer cached)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Prisma client
COPY prisma ./prisma
RUN bunx prisma generate

# Source + build (.next/standalone/server.js)
COPY . .
RUN bun run build

ENV NODE_ENV=production

# Persistent state: SQLite db + published sites (/data),
# project workspaces + artifacts (/app/storage).
RUN mkdir -p /data /app/storage
VOLUME ["/data", "/app/storage"]

EXPOSE 3000

# node:22-slim has no curl/wget — use node fetch for the healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
