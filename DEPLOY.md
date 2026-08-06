# Deploying this repository

This repository is a self-contained Next.js application with a production
Dockerfile at the repository root. Any container platform can deploy it.

## Build

    docker build -t forge .

## Run

    docker run -p 3000:3000 \
      -e PORT=3000 \
      -e DATABASE_URL=file:/data/forge.db \
      forge

## Notes for platform builders (Sealos / any PaaS)

- Use the Dockerfile at the repository root (do NOT auto-detect a framework).
- The container listens on port 3000 (override with PORT).
- No external services are required: SQLite is created automatically on
  first boot, all state lives on the local filesystem (/data, /app/storage).
- Build needs network access (installs bun + npm dependencies) and ~2GB RAM.
- No CI, no GitHub Actions, no external database needed.
