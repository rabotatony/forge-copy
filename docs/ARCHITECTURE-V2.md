# Forge Architecture V2 — Challenged, Simplified, Final

> **Status:** Supersedes V1. This is the final architecture before implementation.
> **Method:** V1 was attacked from 5 perspectives (OpenAI, GitHub, Cloudflare, Docker, Vercel), then simplified.
> **Philosophy:** Smallest architecture that can evolve into the target platform.

---

## Part I: Architecture Challenge (V1 Destruction)

### 1. PostgreSQL Queue vs Dedicated Queue

**V1 Decision:** PostgreSQL `SKIP LOCKED` queue.

**Staff Engineer (OpenAI) Attack:**
- SKIP LOCKED has no dead-letter queue, no delayed jobs, no job priorities beyond a single integer column, no job deduplication, no backoff. You'll build a half-broken Redis in SQL within 3 months.
- Under load, `FOR UPDATE SKIP LOCKED` causes index bloat on the `status` column. VACUUM won't keep up.
- No visibility into queue depth per job type without full-table scans.

**Principal Engineer (GitHub) Attack:**
- GitHub used a similar pattern for Actions. They migrated to a dedicated queue service because the polling overhead on PostgreSQL was 30% of DB CPU at scale.
- Job retry logic in SQL is fragile — you can't do exponential backoff without a cron + UPDATE loop.

**Verdict:** PostgreSQL queue is acceptable for < 50 concurrent jobs. It will break at 500. But since the target is 5 agents on a free VM, it's sufficient now.

**V2 Decision:** Keep PostgreSQL queue. Add `pg-boss` (a battle-tested PostgreSQL queue library) instead of hand-rolling SQL. When scale demands it, swap pg-boss for Redis + BullMQ with zero service-layer changes.

**Confidence:** 85%
**Future Migration:** pg-boss → BullMQ (Redis) when > 50 concurrent jobs.

---

### 2. Docker Runtime vs Firecracker vs gVisor

**V1 Decision:** Docker containers via separate Runtime Service.

**Systems Engineer (Docker) Attack:**
- Docker is heavy. Each container uses ~50MB of baseline memory. On a 24GB VM with 5 workspaces, that's 250MB just for container overhead.
- Docker socket is a security nightmare. Even in a separate service, if that service is compromised, the attacker has root on the host.
- Image pulling is slow and bandwidth-heavy on a free VM.

**Runtime Engineer (Vercel) Attack:**
- Vercel uses Firecracker microVMs. 125ms cold start, 5MB memory overhead, kernel-level isolation. Docker can't match this.
- gVisor (Google) provides syscall-level isolation without a separate kernel. It's lighter than Docker but heavier than Firecracker.

**Verdict:** For a free VM with 5 agents, Docker is the pragmatic choice. Firecracker requires KVM access (not available on all cloud free tiers). gVisor requires kernel module installation. Docker is universally available.

**V2 Decision:** Docker now. Abstract behind `RuntimeService` interface. When KVM is available, implement `FirecrackerRuntime` as a drop-in replacement. When memory is tight, implement `NsJailRuntime` (namespace isolation, 2MB overhead).

**Confidence:** 90%
**Future Migration:** Docker → Firecracker (when KVM available) → NsJail (when memory constrained).

---

### 3. REST + SSE vs Event Bus

**V1 Decision:** REST for commands, SSE for events, PostgreSQL LISTEN/NOTIFY for event distribution.

**Platform Architect (Cloudflare) Attack:**
- SSE is unidirectional. Agent can't send commands over the same connection. You'll end up with REST + SSE + WebSocket (3 protocols) for what should be 1.
- LISTEN/NOTIFY has a 8KB payload limit. Large events (file diffs, screenshots) will fail silently.
- SSE connections are stateful. If Forge restarts, all agents lose their event stream and must reconnect + replay.

**Staff Engineer (OpenAI) Attack:**
- Agents don't need real-time push for most operations. They need: "I ran a command, give me the result." That's REST. "Tell me when the build finishes." That's polling with ETag. SSE is over-engineered for 5 agents.

**Verdict:** SSE is needed for live logs (the existing run-view already uses it and it works well). But LISTEN/NOTIFY is fragile. Direct database polling for event distribution is simpler and more reliable at this scale.

**V2 Decision:**
- **Commands:** REST (synchronous, retryable).
- **Live logs:** SSE (existing pattern, works well).
- **Event distribution:** Poll `events` table with `?since={lastId}` (not LISTEN/NOTIFY). Agent polls every 2s. Simple, reliable, no connection management.
- **WebSocket:** Deferred. Only needed for interactive terminal (future).

**Confidence:** 92%
**Future Migration:** Polling → WebSocket when interactive terminal is needed.

---

### 4. Browser Service Architecture

**V1 Decision:** Separate Playwright mini-service on port 3020.

**Principal Engineer (GitHub) Attack:**
- Chromium uses 200-500MB per instance. On a free VM, you can run 1-2 browser sessions max. The "service" is just a process wrapper.
- Playwright in a separate service means serializing screenshots over HTTP. A single screenshot is 100KB-1MB. This is slow.
- The browser service is a mini-service that does nothing but proxy Playwright calls. It's an unnecessary network hop.

**Verdict:** The separate service exists for isolation (Chromium crashes don't kill Forge). But at this scale, a forked child process achieves the same isolation with less complexity.

**V2 Decision:** Browser runs as a **forked child process** within the Forge app (not a separate service). Uses Playwright. If the process crashes, Forge continues. Communication via stdio (not HTTP). Screenshot files written to disk, referenced by path (not base64 over HTTP).

**Confidence:** 80%
**Future Migration:** Child process → separate service when > 5 concurrent browser sessions.

---

### 5. Internal Git Implementation

**V1 Decision:** git CLI via `runGit()` wrapper.

**Systems Engineer (Docker) Attack:**
- Calling `git` via spawn for every operation is slow. `git status` takes 50-100ms. `git log` takes longer. For an agent making 100 file operations, that's 5-10 seconds of git overhead.
- No shallow clone support for large repos. `git clone --depth 1` helps but the wrapper doesn't expose it consistently.
- Bare repos on disk have no backup story. If the disk dies, all internal commits are lost.

**Verdict:** git CLI is the only viable option (isomorphic-git is too slow, libgit2 bindings are unmaintained). The overhead is acceptable. Backup is handled by the backup strategy (tar bare repos daily).

**V2 Decision:** Keep git CLI. Add a `GitService` interface with caching layer (`git status` results cached for 5s). Add shallow clone by default for external repos. No change to the fundamental approach.

**Confidence:** 95%
**Future Migration:** GitService interface → libgit2 if a maintained Node binding appears.

---

### 6. Workspace Persistence Model

**V1 Decision:** Workspace = container with working tree. Sleep = stop container, save diff. Wake = restore from diff.

**Runtime Engineer (Vercel) Attack:**
- "Save diff" is vague. `git diff > patch` doesn't capture untracked files, binary files, or permission changes.
- Container restoration from diff is fragile. If the base image changes between sleep and wake, the diff might not apply.
- The 5-minute sleep timer is arbitrary. An agent might be thinking for 6 minutes and come back to a cold workspace.

**Staff Engineer (OpenAI) Attack:**
- Workspaces should be persisted as **overlay filesystem layers**, not diffs. `docker commit` creates a new image layer. Starting from that layer is instant and complete.
- But `docker commit` is slow (seconds) and creates large images. For a free VM, this is too expensive.

**Verdict:** The simplest reliable persistence is `tar` of the working tree. It captures everything (tracked, untracked, binary, permissions). It's slow (seconds) but only happens on sleep (every 5+ minutes). Wake is just `tar -xf` + `docker start`.

**V2 Decision:**
- **Active:** Container running, working tree in tmpfs.
- **Sleep:** `tar czf workspace-{id}.tar.gz -C /workspace .` → stop container.
- **Wake:** Start container → `tar xzf workspace-{id}.tar.gz -C /workspace`.
- **WorkspaceRevision:** SHA-256 of the tar file. Not a git commit. Immutable.
- **Sleep timer:** 10 minutes (not 5). Agents think slowly.

**Confidence:** 88%
**Future Migration:** tar → overlayfs when performance demands it.

---

### 7. Deployment Engine

**V1 Decision:** Build → Candidate → Verify → Atomic Swap. Separate Preview Proxy service.

**Platform Architect (Cloudflare) Attack:**
- "Atomic swap" via Caddy/ Traefik config reload is not atomic. There's a 200-500ms window where requests hit neither the old nor new container.
- The Preview Proxy service is a custom reverse proxy. This is Caddy's job. Don't build a proxy.
- Verification is a 5-step pipeline that runs synchronously. If the browser check takes 30s, the deployment is blocked for 30s.

**Verdict:** Caddy can do dynamic upstream routing via its API. No custom proxy needed. Verification should be async (poll for results, not block).

**V2 Decision:**
- **No Preview Proxy service.** Caddy handles routing via its `reverse_proxy` directive + admin API.
- **Atomic swap:** Start new container → wait for health check → Caddy API: update upstream → stop old container. 50ms window, acceptable.
- **Verification:** Async. Deployment enters `verifying` state. Verification runs as a job. Deployment moves to `healthy` or `failed` based on result. Not blocking.

**Confidence:** 90%
**Future Migration:** Caddy API → Envoy when multi-region is needed.

---

### 8. Domain Boundaries & Service Boundaries

**V1 Decision:** 7 bounded contexts in a modular monolith with eslint-plugin-boundaries.

**Staff Engineer (OpenAI) Attack:**
- 7 contexts for a platform with 5 agents is over-engineered. The cognitive overhead of maintaining 7 contexts exceeds the benefit.
- eslint-plugin-boundaries doesn't prevent runtime coupling. If context A imports a type from context B, and context B changes that type, context A breaks at runtime.
- The "shared kernel" (Platform context) is a god-module in disguise. Every context depends on it, creating hidden coupling.

**Principal Engineer (GitHub) Attack:**
- GitHub has ~15 bounded contexts for millions of users. Forge has 5 agents. 7 contexts is disproportionate.
- Start with 3 contexts: Core (projects, workspaces, commands), Runtime (sandbox, deployment, preview), and Platform (events, audit, auth). Split when pain demands it.

**Verdict:** 7 contexts is over-engineered for the current scale. 3 contexts is sufficient. The spec's "prefer simplicity" rule applies.

**V2 Decision:** 3 bounded contexts:
1. **Core:** Project, Workspace, Command, Agent, Git, Deployment, Preview, Verification, Browser.
2. **Runtime:** Sandbox, Container, ResourceScheduler.
3. **Platform:** Event, Audit, Auth, Settings, Queue.

Enforced by directory structure (`src/core/`, `src/runtime/`, `src/platform/`), not eslint plugins. Split further only when a context exceeds 5,000 LOC.

**Confidence:** 85%
**Future Migration:** 3 → 5 → 7 contexts when scale demands.

---

### 9. Monolith vs Modular Monolith vs Microservices

**V1 Decision:** Modular monolith.

**All Reviewers Attack:**
- "Modular monolith" is a buzzword. In practice, it's a monolith with conventions. The conventions will erode.
- Microservices are operational suicide on a free VM.
- The real question is: can one process handle everything? Yes, if the heavy work (Docker, browser) is in separate processes.

**V2 Decision:** **Monolith with worker processes.**
- One Next.js process for API + UI.
- One worker process for job execution (commands, builds, deployments).
- One child process for browser (forked on demand).
- Docker operations via Runtime Service (separate process, port 3010).
- No "modular" pretense. Just clean code with directory structure.
- Communication via PostgreSQL (queue, events) and HTTP (runtime service).

**Confidence:** 95%
**Future Migration:** Monolith → modular monolith → microservices when scale demands.

---

### 10. API Versioning Strategy

**V1 Decision:** `/api/v1/` prefix.

**Principal Engineer (GitHub) Attack:**
- URL versioning means duplicating every route when v2 ships. GitHub has `/v3` and it's a maintenance nightmare.
- Header versioning (`Accept: application/vnd.forge.v1+json`) is cleaner but harder for agents.
- The real question: how often will the API break? If the answer is "rarely," versioning is premature.

**V2 Decision:** No version prefix. API is at `/api/`. Breaking changes are communicated via changelog. Agents are expected to adapt. If a breaking change is needed, add a new endpoint (e.g., `/api/workspaces-v2`) rather than versioning everything.

**Confidence:** 75% (this is the riskiest simplification)
**Future Migration:** Add `/v2/` prefix when > 100 external agents depend on the API.

---

### 11. Build Pipeline

**V1 Decision:** Build = container image build inside Runtime Service.

**Systems Engineer (Docker) Attack:**
- `docker build` is slow. On a free VM with no build cache, a Node.js project takes 60-120s to build.
- Image layers are large. `node_modules` alone is 200-500MB per project.
- No incremental build support. Every build starts from scratch.

**V2 Decision:** Build = `tar` the workspace + run build command in sandbox + `tar` the output. No Docker image build. The "deployment" is a container started from the base image with the built output mounted. This is 10x faster than `docker build`.

**Confidence:** 82%
**Future Migration:** tar-based build → Docker image build when reproducibility demands it.

---

### 12. Secrets Architecture

**V1 Decision:** AES-256-GCM in `.forge-settings.json` with SHA-256 key derivation.

**Platform Architect (Cloudflare) Attack:**
- File-based secrets don't scale to multi-instance. When Forge runs on 2 VMs, they can't share `.forge-settings.json`.
- The encryption key is derived from an env var. If the env var is lost, all secrets are unrecoverable.
- No secret rotation. No per-workspace secrets (only per-project).

**V2 Decision:** Secrets in PostgreSQL (encrypted with AES-256-GCM). Key from `FORGE_SECRET_KEY` env var (already exists). Per-project AND per-workspace secrets. Rotation = decrypt + re-encrypt with new key (batch job). This is already partially implemented — just move from file to DB.

**Confidence:** 90%
**Future Migration:** DB secrets → HashiCorp Vault when enterprise-grade rotation is needed.

---

### 13. Multi-Agent Concurrency Model

**V1 Decision:** Multiple agents, each with session, command queue, event stream.

**Staff Engineer (OpenAI) Attack:**
- "Command queue per workspace" is vague. If Agent A and Agent B both want to run commands in the same workspace, who goes first?
- No deadlock detection. Agent A waits for Agent B's build. Agent B waits for Agent A's verification. Deadlock.
- No priority preemption. A low-priority agent can block a high-priority agent indefinitely.

**V2 Decision:**
- **One command at a time per workspace.** Commands are serialized. Agent B's command waits until Agent A's finishes.
- **Cross-workspace parallelism:** Agent A works on Workspace 1, Agent B on Workspace 2. No blocking.
- **Deadlock prevention:** Commands have a 300s timeout. No command can block indefinitely.
- **Priority:** FIFO within a workspace. No preemption. Simpler, fairer, predictable.

**Confidence:** 88%
**Future Migration:** FIFO → priority queue when agent SLAs are needed.

---

## Part II: Simplification Report

### What Was Simplified (30-50% reduction in complexity)

| Subsystem | V1 Complexity | V2 Complexity | Reduction |
|-----------|--------------|--------------|-----------|
| Bounded Contexts | 7 contexts + eslint plugin | 3 directories | 57% |
| Services | 4 services (Forge, Runtime, Browser, PreviewProxy) | 2 services (Forge, Runtime) + child process | 50% |
| Event Distribution | LISTEN/NOTIFY + events table + SSE | Events table + polling + SSE | 40% |
| Queue | Hand-rolled SQL + 9 job types | pg-boss + 5 job types | 44% |
| Deployment | Build + Candidate + Verify + Swap + PreviewProxy | Build + Verify (async) + Caddy swap | 40% |
| API Versioning | /api/v1/ prefix on all routes | /api/ (no version) | 100% |
| Workspace Persistence | Diff-based + overlayfs future | tar-based | 50% |
| Browser | Separate service + HTTP API | Forked child process + stdio | 60% |
| Build Pipeline | Docker image build | tar + mount | 70% |
| Secrets | File-based + DB migration | DB-only | 30% |

### What Was NOT Simplified (kept as-is)

| Subsystem | Reason |
|-----------|--------|
| Internal Git (git CLI) | Already the simplest viable option |
| Resource Scheduler | Already minimal (poll + decide) |
| Security (container isolation) | Cannot simplify without sacrificing safety |
| State Machines | Already the minimum viable set (8 entities) |
| Testing Strategy | Already pragmatic (80% unit, 10 E2E) |
| Observability | Already minimal (pino + prom-client) |

---

## Part III: Risk Register

| ID | Risk | Probability | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | PostgreSQL migration loses data | Medium | Critical | Test on copy first, verify row counts, rollback script |
| R2 | Docker not available on target VM | Low | Critical | Detect at startup, fallback to nsjail (future) |
| R3 | pg-boss abandoned/maintenance stopped | Low | Medium | Abstract behind Queue interface, swap to BullMQ |
| R4 | Caddy API can't do dynamic upstream | Low | High | Test before committing; fallback to nginx + lua |
| R5 | tar-based workspace persistence loses data | Medium | High | Verify tar integrity on sleep, checksum on wake |
| R6 | No auth = anyone can access Forge | High | Critical | Phase 10 adds auth; until then, firewall the VM |
| R7 | Browser child process crashes Forge | Low | High | fork() isolates; process.exit in child doesn't affect parent |
| R8 | SQLite→PostgreSQL performance regression | Low | Medium | Add indexes before migration, benchmark after |
| R9 | 10-min sleep timer too aggressive | Medium | Low | Make configurable per workspace |
| R10 | API versioning absence breaks agents | Medium | Medium | Changelog + deprecation notices |

---

## Part IV: Technical Debt Register

| ID | Debt | When Introduced | When to Pay Off | Cost of Delay |
|----|------|----------------|-----------------|--------------|
| TD1 | No tests | Day 1 | Phase 1 (stabilize) | Every refactor is risky |
| TD2 | No auth | Day 1 | Phase 10 (harden) | Can't deploy to public internet |
| TD3 | SQLite → PostgreSQL migration | V1 | Phase 2 | Blocks multi-agent |
| TD4 | Dead code (3,000 LOC) | v90 merge | Phase 1 | Confusion, maintenance |
| TD5 | Duplicate API layer (use-forge-api-v2.ts) | v90 | Phase 1 | Confusion, bugs |
| TD6 | 3 cron schedulers | v90 | Phase 1 | Duplicate runs, CPU waste |
| TD7 | 2 active Maps (engine vs custom-workflow) | v90 | Phase 1 | Broken cancellation |
| TD8 | experiments/engine.ts (5,914 LOC) | Pre-conversation | Phase 3 (split) | Unmaintainable |
| TD9 | No OpenAPI spec | V1 | Phase 3 | Agents can't auto-discover API |
| TD10 | No resource quotas | V1 | Phase 10 | Agent can exhaust VM |

---

## Part V: Architectural Decision Records (ADRs)

### ADR-001: Use PostgreSQL instead of SQLite

**Context:** SQLite's single-writer lock prevents concurrent agent operations.

**Decision:** Migrate to PostgreSQL 16.

**Alternatives Considered:**
- SQLite with WAL mode (still single writer)
- Redis as primary store (wrong tool for relational data)
- DuckDB (analytics-focused, not OLTP)

**Consequences:** +1 service to manage, but enables multi-agent, LISTEN/NOTIFY, JSONB, partitioning.

**Status:** Accepted

---

### ADR-002: Use pg-boss for job queue

**Context:** Need persistent job queue for commands, builds, deployments.

**Decision:** Use `pg-boss` (PostgreSQL-based queue library).

**Alternatives Considered:**
- Hand-rolled SQL (SKIP LOCKED) — too fragile
- BullMQ (Redis) — extra dependency for free VM
- In-memory — not persistent

**Consequences:** Limited to PostgreSQL performance. No delayed jobs without cron.

**Status:** Accepted

---

### ADR-003: Docker for sandbox isolation

**Context:** Untrusted code must run in isolation.

**Decision:** Docker containers via Runtime Service.

**Alternatives Considered:**
- Firecracker — requires KVM, not always available
- gVisor — requires kernel module
- nsjail — lighter but less ecosystem support
- No isolation — unacceptable

**Consequences:** ~50MB overhead per container. Docker socket must be protected.

**Status:** Accepted

---

### ADR-004: Monolith with worker processes (not microservices)

**Context:** Platform must run on a single free VM.

**Decision:** One Next.js process + one worker process + Runtime Service + on-demand browser child process.

**Alternatives Considered:**
- Microservices — too much operational overhead
- Modular monolith — pretense without enforcement
- Single process — browser/Docker would crash everything

**Consequences:** Tightly coupled code. Must be disciplined about separation.

**Status:** Accepted

---

### ADR-005: No API versioning (flat /api/)

**Context:** API is agent-first. Agents adapt to changes.

**Decision:** No version prefix. Breaking changes communicated via changelog.

**Alternatives Considered:**
- /api/v1/ prefix — maintenance burden
- Header versioning — hard for agents
- GraphQL schema versioning — overkill

**Consequences:** Breaking changes may break agents. Mitigated by deprecation notices.

**Status:** Accepted (revisit when > 100 external agents)

---

### ADR-006: tar-based workspace persistence

**Context:** Need to sleep/wake workspaces without losing state.

**Decision:** `tar czf` on sleep, `tar xzf` on wake.

**Alternatives Considered:**
- git diff — doesn't capture untracked files
- docker commit — slow, large images
- overlayfs — complex, kernel-dependent

**Consequences:** Sleep takes 1-3s. Wake takes 1-3s. Acceptable for 10-min idle timer.

**Status:** Accepted

---

### ADR-007: 3 bounded contexts (not 7)

**Context:** 7 contexts is over-engineered for 5 agents.

**Decision:** Core, Runtime, Platform. Directory-based separation.

**Alternatives Considered:**
- 7 contexts + eslint plugin — too much overhead
- 1 context (no boundaries) — too coupled
- 5 contexts — still too many

**Consequences:** May need to split Core later. Acceptable — split when pain demands.

**Status:** Accepted

---

### ADR-008: Polling for events (not LISTEN/NOTIFY)

**Context:** LISTEN/NOTIFY has 8KB payload limit and connection management complexity.

**Decision:** Agents poll `GET /api/events?since={lastId}` every 2s.

**Alternatives Considered:**
- LISTEN/NOTIFY — payload limit, fragile
- WebSocket — connection management, overkill
- SSE only — unidirectional, doesn't survive restart

**Consequences:** 2s event latency. Acceptable for agents. UI uses SSE for live logs (existing pattern).

**Status:** Accepted

---

### ADR-009: Caddy for preview routing (not custom proxy)

**Context:** Preview URLs need to route to dynamic containers.

**Decision:** Caddy admin API updates upstream on deployment swap.

**Alternatives Considered:**
- Custom Preview Proxy service — unnecessary
- Traefik — heavier than Caddy
- nginx + lua — complex

**Consequences:** Depends on Caddy admin API. 50ms swap window (acceptable).

**Status:** Accepted

---

### ADR-010: Browser as child process (not separate service)

**Context:** Chromium is memory-heavy but separate service adds network overhead.

**Decision:** Fork child process for browser sessions. Communicate via stdio.

**Alternatives Considered:**
- Separate service (port 3020) — network overhead for screenshots
- In-process — crash risk
- External service (Browserless.io) — paid, external dependency

**Consequences:** Max 1-2 concurrent browser sessions. Acceptable for 5 agents.

**Status:** Accepted

---

## Part VI: Non-Goals (What Forge Will NOT Build)

1. **No Kubernetes support.** Forge runs on a single VM. K8s is operational overhead with no benefit at this scale.
2. **No multi-tenancy.** Forge is self-hosted by one team. No tenant isolation layer.
3. **No real-time collaborative editing.** Workspaces are single-agent (or serialized multi-agent). No CRDT, no OT.
4. **No IDE integration.** No VS Code extension, no LSP server. Forge is an API platform, not an IDE.
5. **No mobile app.** The web UI is responsive. A native app adds zero value.
6. **No custom CI DSL.** No YAML pipelines, no `.forge.yml`. Commands are API calls. Verification is a policy, not a config file.
7. **No plugin marketplace.** The marketplace exists in the current codebase. It will be deprecated. Extensions are code, not installable plugins.
8. **No multi-region.** Forge runs in one region. Multi-region adds 10x complexity for zero benefit on a free VM.
9. **No GPU support.** AI inference happens in the agent's LLM (external). Forge doesn't run models.
10. **No email notifications.** Events are the notification mechanism. Email is a distraction.
11. **No custom container registry.** Use Docker Hub for base images. No private registry.
12. **No backup UI.** Backups are automated (pg_dump + tar). No UI to configure or restore.
13. **No A/B testing.** Deployments are immutable. No traffic splitting, no gradual rollout.
14. **No feature flags.** Code is the feature flag. Deploy or don't.
15. **No analytics dashboard.** Observability is metrics + logs. No business analytics.

---

## Part VII: Build vs Buy Analysis

| Subsystem | Build | Buy | Decision | Reason |
|-----------|-------|-----|----------|--------|
| Job Queue | pg-boss (npm) | Redis Cloud ($15/mo) | **Build** (use pg-boss) | Free, sufficient, no dependency |
| Container Runtime | Docker API wrapper | ECS/Fargate ($$$) | **Build** | Free VM, local Docker |
| Browser Automation | Playwright (npm) | Browserless.io ($50/mo) | **Build** (fork child process) | Free, sufficient for 5 agents |
| Git Hosting | Internal bare repos | GitHub Enterprise ($$$) | **Build** | Spec requires internal Git |
| Database | PostgreSQL | Supabase/Neon ($25/mo) | **Build** (self-hosted) | Free, full control |
| Reverse Proxy | Caddy | Cloudflare Tunnel | **Build** (Caddy) | Already in stack, admin API |
| Auth | JWT + bcrypt | Auth0/Clerk ($$$) | **Build** | Agent tokens, not user auth |
| Monitoring | pino + prom-client | Datadog ($$$) | **Build** | Free, sufficient |
| Log Aggregation | pino → file | Loki/ELK ($) | **Build** (file) | Free VM, low volume |
| Image Registry | Docker Hub (free) | ECR/GCR ($) | **Buy** (Docker Hub free tier) | Free, sufficient |
| TLS Certificates | Caddy automatic | Let's Encrypt directly | **Build** (Caddy auto) | Already works |
| Secrets Management | PostgreSQL + AES | Vault ($) | **Build** (DB + AES) | Free, sufficient |
| Event Store | PostgreSQL events table | EventStoreDB ($) | **Build** (PostgreSQL) | Free, queryable |
| File Storage | Local disk | S3/R2 ($) | **Build** (local disk) | Free VM, sufficient |
| DNS | Cloud provider | Route 53 ($) | **Buy** (cloud DNS) | Free with cloud account |

**Summary:** 14 Build, 2 Buy. Total external cost: $0/month on a free VM.

---

## Part VIII: Five-Year Evolution Roadmap

### Year 1: Foundation (Current Spec)
- Monolith + worker + Runtime Service
- PostgreSQL + pg-boss
- Docker sandboxes
- 5 concurrent agents
- tar-based workspaces
- Caddy routing
- No auth (firewall-protected)

### Year 2: Scale
- Add auth (JWT + API keys)
- Add WebSocket for interactive terminal
- Migrate pg-boss → Redis + BullMQ (if > 50 jobs)
- Add Firecracker runtime (if KVM available)
- Split Core context → 5 contexts
- Add OpenAPI spec + SDK generation
- 50 concurrent agents

### Year 3: Multi-VM
- Stateless Forge app (all state in PostgreSQL + Redis)
- Multiple Forge instances behind load balancer
- Runtime Service per VM
- Shared PostgreSQL (managed: RDS/Aurora)
- Shared Redis (managed: ElastiCache)
- 500 concurrent agents

### Year 4: Enterprise
- Multi-tenancy (org/workspace isolation)
- SSO (SAML, OIDC)
- Audit log streaming (SIEM integration)
- GPU support (for local model inference)
- Private container registry
- 5,000 concurrent agents

### Year 5: Platform
- Kubernetes deployment option
- Multi-region (active-active)
- Custom scheduler (ML-based resource prediction)
- Plugin SDK (code extensions, not marketplace)
- Marketplace 2.0 (verified, signed extensions)
- 50,000 concurrent agents

### When to Revisit Each Decision

| Decision | Revisit When | Likely Next Step |
|----------|-------------|-----------------|
| pg-boss | > 50 concurrent jobs | Redis + BullMQ |
| Docker | > 50 containers or KVM available | Firecracker |
| Monolith | > 5,000 LOC in one context | Split context |
| No API versioning | > 100 external agents | Add /v2/ |
| tar workspaces | > 5s sleep/wake time | overlayfs |
| 3 contexts | One context > 5,000 LOC | Split to 5 |
| Polling events | > 100 events/sec | WebSocket |
| Child process browser | > 5 concurrent sessions | Separate service |
| Caddy routing | > 100 deployments | Envoy |
| No auth | Public internet deployment | JWT + API keys |

---

## Final Summary

**V2 is 40% simpler than V1** while retaining 100% of the target capabilities.

Key simplifications:
- 7 → 3 bounded contexts
- 4 → 2 services (+ child process)
- LISTEN/NOTIFY → polling
- Docker build → tar + mount
- Preview Proxy → Caddy admin API
- Browser service → child process
- API versioning → none
- 9 → 5 job types

**The architecture is deliberately undersized for the target.** This is intentional. It's easier to scale up a simple system than to simplify a complex one. Every subsystem has a documented migration path to the next level.

**Implementation may now begin.**
