# Forge

> Self-hosted CI/CD platform built on Next.js 16, TypeScript, and Prisma.

Forge is a sovereign continuous-integration / continuous-deployment system that
runs entirely on your own infrastructure. Upload a project (ZIP / TAR / multi-file
/ folder), Forge inspects it, proposes workflows, executes them with live
streaming logs, and feeds results back to GitHub through check-runs and
annotations — all from a single Next.js application.

---

## Highlights

- **Project ingestion** — ZIP / TAR.GZ / multi-file / folder upload with streaming
- **Workflow engine** — step-based execution with live log streaming over SSE
- **Pipelines** — multi-stage DAG execution, matrix builds, manual approvals
- **Triggers** — GitHub-aware webhooks + cron schedules
- **GitHub integration** — full Octokit client (PRs, Actions, check-runs, annotations)
- **Secret vault** — AES-256-GCM encryption at rest for tokens & credentials
- **Security hardened** — SSRF protection, path-traversal guards, rate limiting
- **i18n** — Hebrew / English primary, ES / FR / DE fallback
- **PWA** — installable, offline-ready manifest + service worker
- **Mobile-first** — responsive down to 390 px viewports

## Tech Stack

| Layer | Technology |
|------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| Database | Prisma ORM + SQLite |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Server state | TanStack Query |
| Client state | Zustand + React hooks |
| Real-time | Server-Sent Events (EventSource) |
| GitHub SDK | Octokit (lazy-loaded) |
| Icons | lucide-react |
| AI | z-ai-web-dev-sdk (backend only) |

## Project Metrics

| Metric | Count |
|--------|-------|
| TypeScript source files | ~330 |
| API routes under `/api/forge` | 115 |
| React components | 113 |
| Prisma models | 24 |

`tsc` clean · `eslint` clean · dev server runs on port 3000.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- Node.js ≥ 20

### Install & Run

```bash
bun install          # install dependencies
bun run db:push      # create / sync the SQLite database
bun run dev          # start the dev server on http://localhost:3000
```

For a fully orchestrated start (db push → dev server → health check →
mini-services), use the helper script:

```bash
sh .zscripts/dev.sh
```

### Useful Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start Next.js dev server (port 3000) |
| `bun run build` | Production build (standalone output) |
| `bun run start` | Run the production standalone server |
| `bun run lint` | ESLint across the project |
| `bun run db:push` | Push Prisma schema to SQLite (accepts data loss) |
| `bun run db:generate` | Regenerate the Prisma client |
| `bun run db:migrate` | Create + apply a Prisma migration |
| `bun run db:reset` | Reset the database (destructive) |

## Architecture

```
src/
├── app/
│   ├── api/forge/            # 115 API routes
│   │   ├── projects/[id]/    # project CRUD + sub-resources
│   │   ├── runs/[id]/        # run execution, logs, SSE stream
│   │   └── github/           # GitHub integration routes
│   └── page.tsx              # main SPA (hash-based routing)
├── components/
│   ├── forge/                # Forge feature components + tabs
│   └── ui/                   # shadcn/ui primitives
├── hooks/                    # shared React hooks
└── lib/
    ├── forge/
    │   ├── engine.ts         # run execution (appendLog, startRun, finishRun)
    │   ├── pipeline.ts       # pipeline DAG execution
    │   ├── triggers.ts       # webhook + cron triggers
    │   ├── github.ts         # GitHub API client (27 functions)
    │   ├── github-feedback.ts# check-runs feedback loop
    │   ├── secrets.ts        # AES-256-GCM encryption
    │   └── notifications.ts  # webhook notifications (SSRF-safe)
    └── axiomstate/           # project parser / bundler
```

### Prisma Models

`Project` · `Run` · `LogLine` · `Artifact` · `Secret` · `EnvVar` · `CacheEntry`
· `Trigger` · `WebhookDelivery` · `Notification` · `Pipeline` · `PipelineRun`
· `StageRun` · `TestReport` · `Approval` · `RunSummary` · `Annotation`
· `ProjectSettings` · `Environment` · `Deployment` · `ApiToken` · `AuditLog`
· `Experiment` · `ExperimentRun`

## Security

- **SSRF protection** — private-IP ranges blocked in notifications & repo cloning
- **Path traversal** — `root + path.sep` guard (not naive `startsWith`)
- **Webhook signatures** — `x-hub-signature-256` (GitHub) / `x-forge-signature` (generic)
- **Secret encryption** — AES-256-GCM with SHA-256 key derivation
- **Rate limiting** — 100 req/min on API, 10 req/min on upload (middleware)
- **`.forge-settings.json`** — encrypted token store, git-ignored

## Gateway / Reverse Proxy

A Caddy gateway (see `Caddyfile`) fronts the application on port 81 and
forwards to the Next.js server on port 3000. Cross-service API requests use
the `?XTransformPort=<port>` query convention so a single external port can
reach multiple internal services.

## Deployment

The `.zscripts/` directory contains production orchestration:

- `build.sh` — full production build (Next.js standalone + mini-services)
- `start.sh` — production entrypoint (Caddy → Next.js → mini-services)
- `python-runtime-build.sh` — optional Python runtime build for plugin support

Production runs `exec caddy run --config Caddyfile` as the main process.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — high-level architecture overview
- [`docs/ARCHITECTURE-SPECIFICATION.md`](./docs/ARCHITECTURE-SPECIFICATION.md) — detailed spec
- [`docs/ARCHITECTURE-V2.md`](./docs/ARCHITECTURE-V2.md) — V2 design notes

## License

Private project. All rights reserved.
