# Forge Platform Transformation — Complete Architecture Specification

> **Status:** Planning Phase — 100% complete before any implementation begins.
> **Date:** 2026-07-29
> **Author:** Lead Architect
> **Scope:** Full platform transformation from CI/workflow app to AI-native development cloud.

---

## Table of Contents

1. [Domain Model](#1-domain-model)
2. [Ubiquitous Language](#2-ubiquitous-language)
3. [Bounded Contexts](#3-bounded-contexts)
4. [Database Design (PostgreSQL)](#4-database-design-postgresql)
5. [Workspace Lifecycle](#5-workspace-lifecycle)
6. [Execution Runtime Architecture](#6-execution-runtime-architecture)
7. [Deployment Engine Architecture](#7-deployment-engine-architecture)
8. [Internal Git Architecture](#8-internal-git-architecture)
9. [Agent Platform Architecture](#9-agent-platform-architecture)
10. [REST API Design](#10-rest-api-design)
11. [MCP Design](#11-mcp-design)
12. [Event Model](#12-event-model)
13. [Queue & Worker Architecture](#13-queue--worker-architecture)
14. [Browser Automation Architecture](#14-browser-automation-architecture)
15. [Resource Scheduler](#15-resource-scheduler)
16. [Security Threat Model](#16-security-threat-model)
17. [State Machines](#17-state-machines)
18. [Infrastructure Architecture](#18-infrastructure-architecture)
19. [Production Deployment Architecture](#19-production-deployment-architecture)
20. [Backup & Disaster Recovery](#20-backup--disaster-recovery)
21. [Migration Strategy](#21-migration-strategy)
22. [Scaling Strategy](#22-scaling-strategy)
23. [Testing Strategy](#23-testing-strategy)
24. [Observability Strategy](#24-observability-strategy)
25. [Implementation Roadmap & Dependency Graph](#25-implementation-roadmap--dependency-graph)

---

## 1. Domain Model

### Existing Implementation Analysis

The current domain model is workflow-centric:

```
Project → Run → LogLine → Artifact → TestReport
Project → Pipeline → PipelineRun → StageRun → Run
Project → Trigger (webhook/cron) → Run
Project → Secret / EnvVar / CacheEntry
Project → Notification / Environment / Deployment
```

**Limitations:**
- `Project` is a static ZIP upload — no living repository, no branches, no revisions.
- `Run` is a one-shot execution — no persistent state, no session, no resumability.
- No concept of `Workspace` — the developer's living environment.
- No concept of `Deployment` as an immutable, reproducible artifact.
- No concept of `Preview` — a live runtime the agent can inspect.
- No concept of `Agent` — an autonomous actor with identity, session, and permissions.
- No concept of `Verification` — a multi-step validation pipeline.
- No concept of `BrowserSession` — interactive browser automation.
- No concept of `InternalGit` — Forge doesn't own version control.
- No concept of `Command` — execution is coupled to `Run` steps, not first-class.

**Why it cannot satisfy the target:**
The spec requires `Workspace` as the fundamental entity. The current model has no workspace, no persistent development environment, no agent identity, no deployment lifecycle, no browser, no verification. Adding these as fields on existing models would create god-objects.

### Proposed Domain Model

```
Project
 ├── InternalGitRepository (bare, Forge-owned)
 ├── Workspaces[]
 │    ├── WorkspaceRevision[] (immutable snapshots)
 │    ├── CommandHistory[]
 │    ├── AgentSession[]
 │    ├── PreviewDeployment?
 │    └── BuildCache
 ├── Deployments[]
 ├── VerificationRuns[]
 ├── Environments[]
 ├── ExternalGitRemote[] (GitHub, GitLab, etc.)
 └── SyncPolicies[]

Agent
 ├── AgentSession[]
 ├── AgentToken[]
 ├── AgentPermissions
 └── AgentQuota

Deployment
 ├── DeploymentRevision (from Workspace | InternalCommit | ExternalCommit | Upload)
 ├── RuntimeContainer
 ├── HealthCheckResult[]
 └── VerificationRun?

Preview
 ├── PreviewRuntime (container)
 ├── PreviewUrl (stable, never changes)
 └── PreviewSwapHistory[]

BrowserSession
 ├── TargetUrl (preview or deployment)
 ├── InteractionLog[]
 └── Screenshot[]

VerificationRun
 ├── Steps[] (build, runtime-start, health-check, browser-check, policy-check)
 └── Result (pass/fail with evidence)

Command
 ├── WorkspaceId
 ├── SandboxId
 ├── Status (state machine)
 └── Result (stdout, stderr, exitCode, duration)

ResourceQuota
 ├── AgentId | ProjectId
 ├── CpuLimit, MemoryLimit, StorageLimit
 └── CurrentUsage
```

### Alternatives Considered

**Alternative A: Extend existing model** — add `Workspace` as a subtype of `Project`.
- Pros: Minimal migration, backward compatible.
- Cons: God-object, couples two different lifecycles, doesn't support multi-workspace per project.
- Rejected: Violates single responsibility.

**Alternative B: Clean-slate domain** — discard existing model entirely.
- Pros: No legacy constraints, ideal target state.
- Cons: Loses 69 commits of working code, massive migration risk.
- Rejected: Too risky without incremental path.

**Selected: Additive evolution** — keep existing entities as legacy, add new domain entities alongside. Migrate incrementally. `Project` becomes a container that can have `Workspaces`. Old `Run` entity maps to new `Command` for backward compat.

### Migration Steps
1. Add new Prisma models (Workspace, Agent, Deployment, etc.) alongside existing.
2. Add `workspaceId` nullable FK to `Run` — old runs have null, new commands have workspace.
3. Build new domain services that operate on new entities.
4. Migrate UI to use new entities.
5. Deprecate old entities after full migration.

### Risks
- Dual-model confusion during migration.
- Performance impact of additional joins.
- Data consistency between old and new models.

### Acceptance Criteria
- Every new entity has a clear lifecycle (state machine).
- No god-objects (every entity < 15 fields).
- Agent can create, modify, and destroy workspaces via API.
- Existing runs continue to work during migration.

---

## 2. Ubiquitous Language

### Existing Terminology (confused)

| Term | Current Usage | Problem |
|------|--------------|---------|
| Project | ZIP upload | Not a living repo — static |
| Run | One-shot execution | Not resumable, not session-based |
| Workflow | Shell script steps | Coupled to engine, not pluggable |
| Pipeline | Multi-stage run sequence | Not a workspace concept |
| Trigger | Webhook/cron | Not event-driven, not workspace-aware |

### Target Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Project** | A version-controlled codebase with an internal bare git repository. Contains workspaces, deployments, and sync policies. |
| **Workspace** | A persistent development environment with a working tree, branch, command history, and optional preview. The fundamental unit of development. |
| **WorkspaceRevision** | An immutable snapshot of a workspace's file state at a point in time. Created on every file change. Does not require a git commit. |
| **Command** | A single isolated execution inside a workspace sandbox. Has explicit state machine. Result is captured. |
| **Agent** | An autonomous AI actor with identity, permissions, quota, and session. |
| **AgentSession** | A persistent connection between an agent and a workspace. Survives disconnects. |
| **Deployment** | An immutable, reproducible runtime derived from a workspace revision or commit. Has lifecycle (queued → building → running → stopped). |
| **Preview** | A continuously-updated live runtime for a workspace. URL is stable; container swaps atomically. |
| **Verification** | A multi-step validation gate (build, start, health, browser, policy). A deployment succeeds only if verification passes. |
| **BrowserSession** | An interactive browser automation context targeting a preview or deployment. |
| **InternalCommit** | A git commit in Forge's internal bare repository. Does not require GitHub. |
| **SyncPolicy** | Rules for when and how to push internal commits to external remotes (GitHub). |
| **Sandbox** | An isolated container runtime for executing commands. Non-root, readonly, ephemeral. |
| **ResourceQuota** | CPU, memory, storage limits per agent or project. Enforced by scheduler. |
| **Event** | An immutable record of a state change in the system. Drives UI and agent notifications. |

### Why This Matters
Every piece of code, API, database table, and UI label must use these terms consistently. No synonyms. No overloaded meanings. `Run` becomes `Command`. `Workflow` becomes a `Command Template`. `Pipeline` becomes a `Verification Policy`.

---

## 3. Bounded Contexts

### Existing: Monolithic

All logic lives in `src/lib/forge/` with no boundaries. `engine.ts` imports `secrets.ts`, `notifications.ts`, `cache.ts`, `triggers.ts`, `github.ts`, `audit.ts`, `pipeline.ts`, `workflows.ts`, `child-runner.ts`, `test-report.ts`, `matrix.ts`, `analytics.ts`, etc. Every module depends on every other module.

### Target: 7 Bounded Contexts

```
┌─────────────────────────────────────────────────────┐
│                    Forge Platform                     │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ Project  │ Workspace│ Runtime  │ Deploy   │ Browser │
│ Context  │ Context  │ Context  │ Context  │ Context │
├──────────┼──────────┼──────────┼──────────┼─────────┤
│   Agent Context    │  Sync Context  │  Platform Context │
└──────────┴──────────┴──────────┴──────────┴─────────┘
```

| Context | Owns | Dependencies |
|---------|------|-------------|
| **Project** | Project, InternalGitRepository, ExternalGitRemote, SyncPolicy | Platform (events, audit) |
| **Workspace** | Workspace, WorkspaceRevision, Command, CommandHistory, BuildCache | Project, Runtime, Platform |
| **Runtime** | Sandbox, Container, ResourceQuota, Scheduler | Platform (events) |
| **Deployment** | Deployment, Preview, HealthCheck, VerificationRun | Workspace, Runtime, Browser |
| **Browser** | BrowserSession, Interaction, Screenshot | Deployment |
| **Agent** | Agent, AgentSession, AgentToken, AgentPermissions, AgentQuota | Workspace, Platform |
| **Sync** | GitSync, SyncPolicy execution, RemoteRepository | Project |
| **Platform** | Event, EventBus, AuditLog, ResourceMonitor, Settings | (shared kernel) |

### Inter-Context Communication
- **Synchronous:** REST API calls between contexts (never direct imports).
- **Asynchronous:** Events on EventBus (decoupled).
- **Shared Kernel:** Platform context provides Event, AuditLog, Settings — read-only to other contexts.

### Alternatives

**Alternative A: Microservices** — each context is a separate process.
- Pros: True isolation, independent scaling.
- Cons: Operational complexity, network latency, distributed transactions.
- Rejected for now: Single-VM constraint (Oracle Cloud Free).

**Alternative B: Modular monolith** — single process, strict module boundaries enforced by linter.
- Pros: Simple deployment, no network overhead, shared memory.
- Cons: Boundaries are convention, not enforcement.
- **Selected:** Modular monolith with `eslint-plugin-boundaries` to enforce import rules.

### Acceptance Criteria
- No context imports from another context's internal modules.
- Cross-context communication only via REST or EventBus.
- `eslint-plugin-boundaries` rules pass.
- Each context has its own Prisma schema section.

---

## 4. Database Design (PostgreSQL)

### Existing: SQLite

- Single file, single writer, no concurrency.
- 24 models, ~50 indexes.
- Works for dev, dead-ends at multi-agent.

### Why SQLite Cannot Satisfy the Target

| Requirement | SQLite Limitation |
|------------|-------------------|
| Concurrent agents writing logs | Single writer lock — serialized |
| Workspace revisions (high write volume) | WAL helps but doesn't scale |
| Event stream (high insert rate) | No partitioning, no streaming |
| Container state polling | Read contention under load |
| Multi-instance Forge | No shared state |
| JSON queries (detection, matrix) | Limited JSON support |

### Target Schema (PostgreSQL)

```sql
-- Project Context
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  kind TEXT DEFAULT 'unknown',
  detection JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE internal_git_repos (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  bare_path TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE external_git_remotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- github | gitlab | bitbucket
  remote_url TEXT NOT NULL,
  sync_policy TEXT DEFAULT 'manual', -- manual | scheduled | on_verification | on_completion | never
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Workspace Context
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  base_revision_id UUID, -- FK to workspace_revisions
  status TEXT DEFAULT 'idle', -- idle | active | sleeping | archived
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workspace_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_revision_id UUID REFERENCES workspace_revisions(id),
  file_tree_hash TEXT NOT NULL,
  diff_summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_session_id UUID REFERENCES agent_sessions(id),
  command_text TEXT NOT NULL,
  status TEXT DEFAULT 'queued', -- queued | running | completed | failed | canceled | timed_out
  exit_code INTEGER,
  stdout_path TEXT,
  stderr_path TEXT,
  duration_ms INTEGER,
  sandbox_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent Context
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  permissions JSONB DEFAULT '["read","write","execute"]',
  quota_cpu INTEGER DEFAULT 1,
  quota_memory_mb INTEGER DEFAULT 512,
  quota_storage_mb INTEGER DEFAULT 1024,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'connected', -- connected | disconnected | expired
  token_hash TEXT NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT now(),
  disconnected_at TIMESTAMPTZ
);

-- Deployment Context
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),
  revision_id UUID REFERENCES workspace_revisions(id),
  internal_commit_sha TEXT,
  status TEXT DEFAULT 'queued', -- queued | building | running | healthy | unhealthy | stopped | failed
  container_id TEXT,
  preview_url TEXT,
  health_check_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  stopped_at TIMESTAMPTZ
);

CREATE TABLE previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  current_deployment_id UUID REFERENCES deployments(id),
  url TEXT NOT NULL,
  status TEXT DEFAULT 'idle', -- idle | building | swapping | live | error
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE verification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending | running | passed | failed
  steps JSONB NOT NULL, -- [{type, status, result}]
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Browser Context
CREATE TABLE browser_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_url TEXT NOT NULL,
  deployment_id UUID REFERENCES deployments(id),
  status TEXT DEFAULT 'idle', -- idle | navigating | interacting | finished | error
  created_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE browser_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_session_id UUID NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- navigate | click | type | scroll | screenshot | eval
  params JSONB DEFAULT '{}',
  result JSONB DEFAULT '{}',
  screenshot_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Platform (Shared Kernel)
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  actor_type TEXT, -- agent | user | system
  actor_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resource_usage (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL, -- workspace | deployment | preview | command
  entity_id UUID NOT NULL,
  cpu_percent FLOAT,
  memory_mb INTEGER,
  storage_mb INTEGER,
  measured_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_workspaces_project ON workspaces(project_id);
CREATE INDEX idx_commands_workspace ON commands(workspace_id);
CREATE INDEX idx_commands_status ON commands(status);
CREATE INDEX idx_deployments_project ON deployments(project_id);
CREATE INDEX idx_events_type_entity ON events(event_type, entity_id);
CREATE INDEX idx_events_created ON events(created_at);
```

### Alternatives

**Alternative A: Keep SQLite, add read replicas.**
- Pros: No migration.
- Cons: Still single writer, no real concurrency.
- Rejected.

**Alternative B: Use PostgreSQL with Prisma.**
- Pros: Prisma already in use, multi-writer, JSONB, partitioning.
- Cons: Migration effort, Prisma limitations on partitioning.
- **Selected.**

**Alternative C: Use PostgreSQL with raw SQL + query builder (kysely).**
- Pros: Full PostgreSQL feature access (partitioning, listen/notify).
- Cons: Lose Prisma type safety.
- Future consideration when partitioning is needed.

### Migration Steps
1. Install PostgreSQL.
2. Update `prisma/schema.prisma` datasource to PostgreSQL.
3. Create new tables alongside old ones.
4. Write migration script: copy `projects` → new `projects`, `runs` → `commands`, etc.
5. Switch datasource.
6. Verify.

### Risks
- Data loss during migration.
- Prisma + PostgreSQL partitioning limitations.
- Performance regression from missing indexes.

### Acceptance Criteria
- PostgreSQL handles 50 concurrent agents without lock contention.
- Events table supports 10K inserts/sec.
- JSONB queries on detection/matrix are indexed and fast.

---

## 5. Workspace Lifecycle

### Existing: No Workspace

Projects are static. "Running a workflow" creates a transient `Run` that disappears after completion. There's no persistent state, no working tree, no session.

### Target Lifecycle

```
                    ┌──────────┐
          create──→ │  IDLE    │ ←── wake
                    └────┬─────┘
                         │ open (agent connects)
                         ▼
                    ┌──────────┐
                    │  ACTIVE   │ ←── file change, command
                    └────┬─────┘
                         │ no activity for 5min
                         ▼
                    ┌──────────┐
                    │ SLEEPING  │ ←── (container stopped, state saved)
                    └────┬─────┘
                         │ agent reconnects OR command requested
                         ▼
                    ┌──────────┐
                    │  ACTIVE   │ (container resumed from snapshot)
                    └────┬─────┘
                         │ archive
                         ▼
                    ┌──────────┐
                    │ ARCHIVED  │ (read-only, compressed)
                    └──────────┘
```

### State Transitions

| From | To | Trigger | Side Effects |
|------|-----|---------|-------------|
| (none) | IDLE | Create workspace | Init working tree from project default branch |
| IDLE | ACTIVE | Agent session opens | Start sandbox container |
| ACTIVE | ACTIVE | File change | Create WorkspaceRevision, emit `WorkspaceChanged` |
| ACTIVE | ACTIVE | Command | Create Command, run in sandbox, emit `CommandStarted`/`CommandFinished` |
| ACTIVE | SLEEPING | 5min inactivity | Stop container, save diff to disk |
| SLEEPING | ACTIVE | Reconnect or command | Resume container from saved diff |
| ACTIVE/IDLE | ARCHIVED | Archive request | Stop container, compress working tree, mark read-only |
| SLEEPING | ARCHIVED | 7 days sleeping | Auto-archive |

### Alternatives

**Alternative A: No sleeping — keep containers always running.**
- Pros: Instant response.
- Cons: Resource exhaustion on free VM.
- Rejected: Spec requires cost optimization.

**Alternative B: Sleep on idle, manual wake only.**
- Pros: Simple.
- Cons: Agent can't autonomously wake.
- Rejected: Spec requires autonomous agents.

**Selected: Auto-sleep + auto-wake** — 5min idle → sleep, any command/request → wake. Predictable, resource-efficient, agent-friendly.

### Acceptance Criteria
- Workspace survives server restart (state on disk).
- Sleep/wake cycle < 3 seconds.
- Agent can wake a sleeping workspace via API.
- Archived workspace is read-only and compressed.

---

## 6. Execution Runtime Architecture

### Existing: Direct `spawn('bash', ['-c', command])`

Commands run as the Next.js server process's user. Full filesystem access. Full network access. No isolation. No quotas. No timeout enforcement (beyond a `setTimeout` + SIGTERM).

**Why it cannot satisfy the target:**
- Spec requires: non-root, readonly root FS, ephemeral FS, CPU/memory/PID limits, seccomp, apparmor, isolated network, no Docker socket, no host mounts.
- Current: zero of these.

### Target: Container-Based Sandbox

```
Agent → API → Workspace Service → Runtime Service → Docker API → Container
                                                              ↓
                                                         Sandbox:
                                                         - non-root user
                                                         - readonly rootfs
                                                         - tmpfs /workspace
                                                         - CPU/memory limits
                                                         - PID limit
                                                         - network: none (or restricted)
                                                         - timeout: 300s default
                                                         - seccomp profile
```

### Runtime Service API

```typescript
interface RuntimeService {
  createSandbox(opts: SandboxOptions): Promise<SandboxId>;
  exec(sandboxId: SandboxId, command: string, opts: ExecOptions): Promise<ExecResult>;
  writeFile(sandboxId: SandboxId, path: string, content: Buffer): Promise<void>;
  readFile(sandboxId: SandboxId, path: string): Promise<Buffer>;
  listFiles(sandboxId: SandboxId, path: string): Promise<FileEntry[]>;
  stopSandbox(sandboxId: SandboxId): Promise<void>;
  snapshot(sandboxId: SandboxId): Promise<SnapshotId>;
  restore(snapshotId: SnapshotId): Promise<SandboxId>;
}

interface SandboxOptions {
  workspaceId: string;
  image: string;           // base image (node:20-slim, python:3.12-slim, etc.)
  cpuLimit: number;        // cores
  memoryLimitMb: number;
  timeoutMs: number;
  networkMode: 'none' | 'restricted';  // restricted = allow only Forge proxy
  env: Record<string, string>;
  workingDir: string;
}
```

### Alternatives

**Alternative A: Docker API directly from Next.js.**
- Pros: Simple, no extra service.
- Cons: Next.js process has Docker socket access (security risk), tight coupling.
- Rejected.

**Alternative B: Separate Runtime Service (mini-service).**
- Pros: Isolation, Forge process never touches Docker socket, can be replaced with gVisor/Firecracker later.
- Cons: Extra process, network hop.
- **Selected.**

**Alternative C: WebAssembly (Wasmtime) sandbox.**
- Pros: No Docker, microsecond startup, true isolation.
- Cons: Limited ecosystem, can't run arbitrary shell commands.
- Future consideration for specific safe commands.

### Acceptance Criteria
- Untrusted code cannot escape the container.
- Sandbox startup < 2 seconds.
- File writes to `/workspace` are captured as diffs.
- Network access is blocked by default (Forge proxy for package registries).
- CPU/memory limits enforced via cgroups.

---

## 7. Deployment Engine Architecture

### Existing: No Deployment Concept

"Deployments" in the current schema are just `Environment` rows with a URL field. No actual deployment happens — no container, no health check, no verification.

### Target: Immutable, Verified Deployments

```
WorkspaceRevision
       ↓
  Build Phase (container image OR static files)
       ↓
  Candidate Runtime (container started, not exposed)
       ↓
  Health Check (HTTP probe to /healthz)
       ↓
  Verification Run (build, runtime, browser, policy)
       ↓
  Atomic Swap (old container → new container, URL unchanged)
       ↓
  Live Deployment
```

### Deployment Lifecycle

```
QUEUED → BUILDING → CANDIDATE → VERIFYING → HEALTHY → RUNNING → STOPPED
                                   ↓              ↓
                                FAILED       UNHEALTHY
```

### Preview vs Deployment

| Aspect | Preview | Deployment |
|--------|---------|-----------|
| Scope | Per-workspace | Per-project |
| URL | `preview-{wsId}.forge.local` | `{project-slug}.forge.local` |
| Lifetime | Until workspace archived | Until explicitly stopped |
| Update | Atomic swap on file change | Manual or policy-triggered |
| Verification | Optional | Required |

### Alternatives

**Alternative A: Docker Compose per deployment.**
- Pros: Simple, supports multi-container apps.
- Cons: Heavy, slow startup, resource intensive.
- Rejected for single-container apps.

**Alternative B: Docker container per deployment + Traefik/Caddy for routing.**
- Pros: Fast, Caddy already in the stack, supports health checks.
- Cons: One container per deployment.
- **Selected** for single-service apps.

**Alternative C: Kubernetes.**
- Pros: Full orchestration, auto-scaling.
- Cons: Way too heavy for a free VM.
- Rejected.

### Acceptance Criteria
- Deployments are immutable (same revision → same container).
- Atomic swap < 1 second (zero-downtime).
- Failed verification prevents deployment.
- Preview URL never changes across swaps.

---

## 8. Internal Git Architecture

### Existing: No Internal Git

Projects are ZIP uploads. `git.ts` wraps the `git` CLI for clone/pull/branch operations on **external** repos. There's no internal bare repository.

### Target: Forge Owns Git

```
Project
  └── /storage/git/{projectId}.git (bare repo)
       ├── branches: main, forge/workspace-{id}, forge/deploy-{id}
       ├── commits: internal (not pushed to GitHub)
       └── sync: async push to GitHub per SyncPolicy

Workspace
  └── working tree = checkout of branch `forge/workspace-{id}`
       ├── uncommitted changes → WorkspaceRevision
       ├── commit → InternalCommit (in bare repo, not pushed)
       └── push → ExternalGitRemote (async, per SyncPolicy)
```

### Sync Policies

| Policy | Trigger | Blocking? |
|--------|---------|-----------|
| `manual` | User/agent calls sync API | No |
| `scheduled` | Cron (e.g., every hour) | No |
| `on_verification` | Verification passes | No |
| `on_completion` | Agent session ends | No |
| `never` | Never (Forge-only project) | N/A |

### Alternatives

**Alternative A: libgit2 (node-git).**
- Pros: No shell, in-process, fast.
- Cons: Limited features, no shallow clone, some bugs.
- Rejected: Need full git compatibility.

**Alternative B: isomorphic-git.**
- Pros: Pure JS, no git binary.
- Cons: Slow, limited, no packfile support.
- Rejected.

**Selected: git CLI (already wrapped in git.ts)** — create bare repos via `git init --bare`, manage via existing `runGit()` primitive. Extend `git.ts` with `initBareRepo`, `commitAll`, `pushToRemote`, `createBranch`.

### Acceptance Criteria
- Every project has an internal bare repo.
- Commits happen without GitHub.
- Sync is async and non-blocking.
- GitHub outage doesn't block development.

---

## 9. Agent Platform Architecture

### Existing: No Agent Concept

The `agent/route.ts` is a simple POST endpoint with actions: `get-files`, `update-files`, `run-workflow`, `get-status`, `log`, `commit`, `open-pr`. No identity, no session, no permissions, no quota.

### Target: Full Agent Platform

```
Agent
 ├── Identity (name, token, permissions)
 ├── Session (websocket connection to workspace)
 ├── Command Queue (serialized per workspace)
 ├── Event Stream (subscribes to workspace events)
 ├── Quota (CPU, memory, storage, commands/min)
 └── Audit Trail (every action logged)

Agent → Forge API → Workspace → Sandbox → Result
                              ↑
                         Event Stream → Agent (real-time updates)
```

### Agent API (REST + WebSocket)

```
POST   /api/agents                      — create agent
POST   /api/agents/:id/sessions         — start session (returns token)
DELETE /api/agents/:id/sessions/:sid    — end session
GET    /api/agents/:id/events           — SSE event stream
POST   /api/workspaces/:id/commands     — execute command
GET    /api/workspaces/:id/files        — read files
PUT    /api/workspaces/:id/files        — write files
POST   /api/workspaces/:id/deployments  — create deployment
POST   /api/workspaces/:id/preview      — trigger preview update
POST   /api/workspaces/:id/commits      — create internal commit
POST   /api/workspaces/:id/browser      — start browser session
```

### Alternatives

**Alternative A: REST polling.**
- Pros: Simple.
- Cons: Latency, wasted requests.
- Rejected for real-time needs.

**Alternative B: WebSocket.**
- Pros: Real-time, bidirectional.
- Cons: Connection management, doesn't survive restart.
- Selected for command channel.

**Selected: REST + SSE** — REST for commands (stateless, retryable), SSE for events (real-time, fire-and-forget). WebSocket for interactive terminal (future).

### Acceptance Criteria
- Multiple agents can work simultaneously without interference.
- Agent sessions survive server restart (reconnect via token).
- Every agent action is audited.
- Quota violations are enforced.

---

## 10. REST API Design

### Existing: 103 Ad-Hoc Routes

Routes are inconsistent:
- 13 use `response.ts` helpers (`ok()`, `fail()`, `notFound()`).
- 89 use ad-hoc `Response.json({error})`.
- Response shapes vary (`{project}`, `{run}`, `{ok: true}`, raw data).
- No versioning, no pagination standard, no filtering.

### Target: Versioned, Consistent, Agent-First API

```
Base URL: /api/v1

Resources:
  /projects
  /projects/:id/workspaces
  /projects/:id/deployments
  /projects/:id/git/remotes
  /projects/:id/git/sync

  /workspaces/:id
  /workspaces/:id/files
  /workspaces/:id/commands
  /workspaces/:id/revisions
  /workspaces/:id/preview
  /workspaces/:id/commits

  /agents
  /agents/:id/sessions
  /agents/:id/events

  /deployments/:id
  /deployments/:id/verification
  /deployments/:id/browser

  /browser-sessions/:id
  /browser-sessions/:id/actions

  /events (SSE stream)
  /health
  /metrics
```

### Response Envelope

```json
{
  "data": { ... },
  "meta": { "page": 1, "limit": 50, "total": 120 }
}
```

Error:
```json
{
  "error": { "code": "WORKSPACE_NOT_FOUND", "message": "Workspace not found", "details": {} }
}
```

### Alternatives

**Alternative A: GraphQL.**
- Pros: Client-driven queries, no over/under-fetching.
- Cons: Complexity, caching, auth granularity.
- Rejected: Agents prefer REST (simpler tooling).

**Alternative B: REST + OpenAPI spec.**
- Pros: Standard, toolable, agent-friendly, simple.
- **Selected.**

### Acceptance Criteria
- OpenAPI 3.1 spec generated from code.
- All routes use `response.ts` helpers.
- Pagination via `?page=&limit=`.
- Filtering via `?filter[field]=value`.
- Rate-limited per agent token.

---

## 11. MCP Design

### Existing: None

### Target: MCP Server Sharing REST Service Layer

```
MCP Client (Claude, etc.)
      ↓
  MCP Server (stdio or HTTP)
      ↓
  Service Layer (shared with REST)
      ↓
  Domain Services (Workspace, Runtime, Deployment, etc.)
```

MCP tools map 1:1 to REST endpoints:
- `workspace.create` → `POST /api/v1/projects/:id/workspaces`
- `workspace.execute` → `POST /api/v1/workspaces/:id/commands`
- `workspace.read_file` → `GET /api/v1/workspaces/:id/files?path=`
- `workspace.write_file` → `PUT /api/v1/workspaces/:id/files`
- `workspace.deploy` → `POST /api/v1/workspaces/:id/deployments`
- `workspace.browser_open` → `POST /api/v1/workspaces/:id/browser`
- `workspace.browser_screenshot` → `POST /api/v1/browser-sessions/:id/actions`
- `workspace.commit` → `POST /api/v1/workspaces/:id/commits`
- `workspace.sync` → `POST /api/v1/projects/:id/git/sync`

### Key Principle
MCP server contains **zero** business logic. It's a thin adapter that calls the same service layer as REST. No duplication.

### Acceptance Criteria
- MCP and REST produce identical results for the same operation.
- Adding a new capability = add service method + REST route + MCP tool (3 files, no logic duplication).
- MCP server can run as standalone process or embedded.

---

## 12. Event Model

### Existing: In-Memory `emit()` + SSE

`engine.ts` has an in-memory `listeners` Map and `emit()` function. Events are not persisted. If the server restarts, all events are lost. Events are tightly coupled to the engine — no other module can emit.

### Target: Persistent Event Log + EventBus

```typescript
interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventType: string, handler: (event: DomainEvent) => void): () => void;
  replay(fromTimestamp: Date, filter: EventFilter): AsyncIterable<DomainEvent>;
}

interface DomainEvent {
  id: string;
  type: string;           // WorkspaceChanged, CommandStarted, DeploymentHealthy, etc.
  entityType: string;     // workspace, command, deployment, etc.
  entityId: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}
```

### Event Types

| Category | Events |
|----------|--------|
| Workspace | `WorkspaceCreated`, `WorkspaceActivated`, `WorkspaceSlept`, `WorkspaceChanged`, `WorkspaceArchived` |
| Command | `CommandQueued`, `CommandStarted`, `CommandFinished`, `CommandTimedOut` |
| Deployment | `DeploymentQueued`, `DeploymentBuilding`, `DeploymentCandidateReady`, `DeploymentVerifying`, `DeploymentHealthy`, `DeploymentUnhealthy`, `DeploymentFailed`, `DeploymentStopped` |
| Preview | `PreviewUpdateStarted`, `PreviewSwapped`, `PreviewError` |
| Browser | `BrowserSessionOpened`, `BrowserActionCompleted`, `BrowserSessionClosed` |
| Git | `InternalCommitCreated`, `GitSyncStarted`, `GitSyncCompleted`, `GitSyncFailed` |
| Agent | `AgentSessionOpened`, `AgentSessionClosed`, `AgentQuotaExceeded` |
| Verification | `VerificationStarted`, `VerificationStepPassed`, `VerificationStepFailed`, `VerificationCompleted` |

### Implementation

**Selected: PostgreSQL `LISTEN/NOTIFY` + events table.**
- Events are persisted to `events` table (partitioned by date).
- `NOTIFY` pushes to all connected listeners (SSE, WebSocket).
- `LISTEN` in Forge process receives and dispatches to subscribers.
- Replay: `SELECT * FROM events WHERE created_at > $1 ORDER BY created_at`.

### Alternatives

**Alternative A: Redis Pub/Sub.**
- Pros: Battle-tested, fast.
- Cons: Extra dependency, not on free VM.
- Rejected.

**Alternative B: In-memory + WAL.**
- Pros: No extra deps.
- Cons: Lost on restart, no multi-instance.
- Rejected.

### Acceptance Criteria
- Events survive server restart.
- Agents can replay events from any timestamp.
- Event latency < 100ms from publish to subscriber.
- Events table doesn't grow unbounded (partitioning + retention).

---

## 13. Queue & Worker Architecture

### Existing: In-Memory `void (async () => {...})()`

Background work is fire-and-forget async IIFEs. No queue, no retry, no priority, no visibility. If the server crashes, all in-flight work is lost.

### Target: Persistent Queue + Worker Pool

```
API Request → Enqueue Job → Queue (PostgreSQL) → Worker Pool → Execute → Result
                                     ↓
                                Priority + Dedup
```

### Job Types

| Type | Priority | Timeout | Retry |
|------|----------|---------|-------|
| Command execution | high | 300s | 0 |
| Build | high | 600s | 1 |
| Deployment swap | high | 60s | 0 |
| Preview update | medium | 300s | 1 |
| Verification | medium | 600s | 0 |
| Git sync | low | 120s | 3 |
| Browser session | medium | 120s | 0 |
| Cleanup | low | 60s | 0 |
| Snapshot | low | 60s | 1 |

### Implementation

**Selected: PostgreSQL-based queue (SKIP LOCKED).**

```sql
-- Enqueue
INSERT INTO jobs (type, payload, priority, status) VALUES ($1, $2, $3, 'pending');

-- Dequeue (worker)
UPDATE jobs SET status = 'running', started_at = now(), worker_id = $1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY priority DESC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;

-- Complete
UPDATE jobs SET status = 'completed', result = $2, finished_at = now() WHERE id = $1;
```

### Alternatives

**Alternative A: BullMQ (Redis).**
- Pros: Feature-rich, battle-tested.
- Cons: Requires Redis, not on free VM.
- Rejected.

**Alternative B: In-process worker pool.**
- Pros: Simple.
- Cons: Lost on restart, no persistence.
- Rejected.

### Acceptance Criteria
- Jobs survive server restart (pending jobs resume).
- Workers can be added/removed dynamically.
- Priority ordering is respected.
- Stalled jobs (worker died) are re-queued after timeout.

---

## 14. Browser Automation Architecture

### Existing: None

The `agent-browser` CLI is used by the Forge dev process for E2E testing, but it's not exposed to agents or users.

### Target: Headless Browser Service

```
Agent → POST /api/v1/browser-sessions
            ↓
     Browser Service (mini-service, port 3010)
            ↓
     Playwright (headless Chromium)
            ↓
     Target: Preview URL or Deployment URL
            ↓
     Results: screenshots, console logs, DOM, accessibility tree
```

### Capabilities

| Action | API | Result |
|--------|-----|--------|
| Navigate | `POST /actions {action: "navigate", url}` | Page loaded, status code |
| Screenshot | `POST /actions {action: "screenshot"}` | PNG base64 |
| Click | `POST /actions {action: "click", selector}` | Element clicked |
| Type | `POST /actions {action: "type", selector, text}` | Text entered |
| Eval | `POST /actions {action: "eval", script}` | JS result |
| Console logs | `GET /console-logs` | Array of log entries |
| Page errors | `GET /errors` | Array of error entries |
| Network | `GET /network` | Array of requests |
| DOM snapshot | `GET /dom` | HTML string |
| Accessibility tree | `GET /a11y` | A11y tree JSON |

### Alternatives

**Alternative A: Playwright in Next.js process.**
- Pros: No extra service.
- Cons: Chromium in server process = memory, crash risk.
- Rejected.

**Selected: Separate mini-service (port 3010)** using Playwright. Communicates via REST. Forge proxies through `XTransformPort`.

### Acceptance Criteria
- Browser sessions are isolated (one Chromium context per session).
- Sessions auto-close after 5min idle.
- Screenshots are stored on disk and referenced by path.
- Agent can detect runtime errors via `/errors` endpoint.

---

## 15. Resource Scheduler

### Existing: None

No resource awareness. All work runs immediately. No limits. No scheduling.

### Target: Resource-Aware Scheduler

```
                    ┌──────────────┐
                    │  Scheduler    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         CPU Queue    RAM Queue    Disk Queue
              │            │            │
              ▼            ▼            ▼
         Decision: run now? sleep? queue? evict?
```

### Scheduler Decisions

| Situation | Action |
|-----------|--------|
| CPU > 80% | Queue new commands, don't start new builds |
| RAM > 90% | Stop sleeping previews, don't start new containers |
| Disk > 85% | Run cleanup: old logs, old images, compressed workspaces |
| Idle preview > 1h | Stop container, keep state on disk |
| Agent quota exceeded | Reject command with 429 |
| Build queue > 10 | Reject new builds with 429 |

### Implementation

- Polls `/proc/stat`, `free -m`, `df -h` every 5 seconds.
- Stores metrics in `resource_usage` table.
- Exposes `GET /api/v1/metrics` for observability.
- Scheduler runs as part of the Platform context (in-process).

### Acceptance Criteria
- Scheduler prevents OOM kills.
- Agent commands are rejected (not silently dropped) when resources are low.
- Idle previews are stopped automatically.
- Disk cleanup runs before disk is full.

---

## 16. Security Threat Model

### Existing: Non-Existent

All routes open. No auth. No sandbox. No rate limiting (middleware exists but is incomplete). Secrets encrypted at rest but token in process.env.

### Threat Model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| **Malicious code execution** | Agent runs `rm -rf /` in workflow | Container sandbox (non-root, readonly, tmpfs) |
| **SSRF** | Agent clones repo from `http://169.254.169.254/` | URL validation + DNS resolution check (fix existing bug) |
| **Path traversal** | Agent writes to `../../../etc/passwd` | `root + path.sep` check (already fixed) |
| **Token theft** | GitHub PAT in `.forge-settings.json` | Encrypt with FORGE_ENCRYPTION_KEY, gitignore, mask in logs |
| **Token leak via logs** | Secret value appears in stdout | `maskSecrets()` with length-desc sort (already fixed) |
| **Agent impersonation** | No auth → anyone calls agent API | Agent tokens (hashed, scoped, expiring) |
| **Resource exhaustion** | Agent spawns 1000 containers | Resource quotas + scheduler enforcement |
| **Container escape** | Bug in Docker/containerd | Run as non-root, seccomp, apparmor, no Docker socket |
| **Supply chain** | Malicious npm package in project | Network isolation (no npm registry access from sandbox) |
| **Replay attack** | Agent token stolen, reused | Token expiry + IP binding + nonce |
| **Privilege escalation** | Agent writes to Forge source code | Workspace isolation (sandbox can't see Forge files) |

### Authentication Design

```
Agent → POST /api/v1/agents/:id/sessions {token}
       ↓
  Forge validates token hash
       ↓
  Returns session token (JWT, 1h expiry)
       ↓
  Agent includes JWT in Authorization header
       ↓
  Forge validates JWT + permissions + quota
```

### Acceptance Criteria
- Untrusted code cannot access Forge files.
- Agent tokens expire.
- Rate limiting per agent.
- All actions audited.
- Secrets never appear in logs.

---

## 17. State Machines

### Existing: Implicit Status Fields

`Run.status` is a string field with values `queued|running|success|failed|canceled|waiting_approval`. Transitions are implicit — any code can set any status at any time. No validation.

### Target: Explicit State Machines

Every long-running entity has a defined state machine:

```
Workspace:     idle → active → sleeping → active → archived
Command:       queued → running → completed | failed | canceled | timed_out
Deployment:    queued → building → candidate → verifying → healthy → running → stopped
                            ↓              ↓           ↓
                         failed        failed      unhealthy
Preview:       idle → building → swapping → live → error
Verification:  pending → running → passed | failed
BrowserSession: idle → navigating → interacting → finished | error
GitSync:       idle → syncing → synced | failed
AgentSession:  connected → disconnected → expired
```

### Implementation Pattern

```typescript
interface StateMachine<TStatus extends string> {
  currentState: TStatus;
  transition(to: TStatus): Result<void, TransitionError>;
  canTransition(to: TStatus): boolean;
  validTransitions: Record<TStatus, TStatus[]>;
}
```

Enforced at the service layer. API returns 409 Conflict for invalid transitions.

### Acceptance Criteria
- Invalid transitions return 409.
- Every status change is audited.
- State machines are documented in OpenAPI spec.

---

## 18. Infrastructure Architecture

### Existing: Single Next.js Process

```
Caddy (80/443) → Next.js (3000)
```

### Target: Multi-Service Architecture

```
Caddy (80/443)
  ├── / → Next.js Forge App (3000)
  ├── /api/runtime → Runtime Service (3010)
  ├── /api/browser → Browser Service (3020)
  ├── /preview/* → Preview Proxy (3030)
  └── /ws → WebSocket Gateway (3040) [future]
```

### Services

| Service | Port | Responsibility |
|---------|------|---------------|
| Forge App | 3000 | Main API + UI (Next.js) |
| Runtime Service | 3010 | Container management (Docker API) |
| Browser Service | 3020 | Playwright browser automation |
| Preview Proxy | 3030 | Route preview URLs to containers |

### Why Separate Services
- **Runtime Service:** Isolates Docker socket access. Forge process never touches Docker.
- **Browser Service:** Chromium is memory-heavy; isolating prevents OOM in Forge.
- **Preview Proxy:** Needs to dynamically route based on container IP:port. Caddy can't do this dynamically.

### Acceptance Criteria
- Each service can be restarted independently.
- Services communicate via REST (not shared memory).
- Caddy routes based on path prefix.

---

## 19. Production Deployment Architecture

### Target: Docker Compose on Single VM

```yaml
# docker-compose.yml
services:
  forge:
    build: .
    ports: ["3000:3000"]
    depends_on: [postgres]
    env_file: .env

  runtime:
    build: ./mini-services/runtime
    ports: ["3010:3010"]
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
    depends_on: [forge]

  browser:
    build: ./mini-services/browser
    ports: ["3020:3020"]

  preview-proxy:
    build: ./mini-services/preview-proxy
    ports: ["3030:3030"]

  postgres:
    image: postgres:16-alpine
    volumes: ["pgdata:/var/lib/postgresql/data"]
    environment:
      POSTGRES_DB: forge
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile"]

volumes:
  pgdata:
```

### Alternatives

**Alternative A: Kubernetes.**
- Rejected: Too heavy for free VM.

**Alternative B: Bare metal (no Docker for Forge itself).**
- Pros: Less overhead.
- Cons: No reproducibility.
- Rejected.

**Selected: Docker Compose** — single `docker-compose up`, reproducible, fits on free VM.

### Acceptance Criteria
- `docker-compose up` starts the entire platform.
- Each service has a health check.
- Caddy auto-provisions TLS certificates.
- PostgreSQL data persists across restarts.

---

## 20. Backup & Disaster Recovery

### Strategy

| Data | Backup Method | Frequency | Retention |
|------|-------------|-----------|-----------|
| PostgreSQL | `pg_dump` | Hourly | 7 days |
| Internal Git repos | `tar` bare repos | Daily | 30 days |
| Workspace state | `tar` workspace dirs | Daily | 7 days |
| Docker images | Registry push | On build | 10 images |
| Configuration | Git (external repo) | On change | Forever |

### Recovery Procedure

1. Restore PostgreSQL from latest dump.
2. Restore internal git repos from tar.
3. Restore workspace state from tar.
4. Restart services.
5. Verify health endpoint.
6. Replay events from last checkpoint.

### RTO/RPO

- **RTO (Recovery Time Objective):** 30 minutes.
- **RPO (Recovery Point Objective):** 1 hour (PostgreSQL dump frequency).

### Acceptance Criteria
- Full recovery from backup in < 30 minutes.
- Backups are encrypted at rest.
- Backup integrity verified via test restore.

---

## 21. Migration Strategy

### Phase 1: Stabilize (Week 1)
- Fix SSRF bug in clone-repo.
- Consolidate 3 schedulers → 1.
- Consolidate 2 `active` Maps → 1.
- Remove dead code (3,000 LOC).
- Delete `use-forge-api-v2.ts`.
- Delete `scheduler.ts` + `ScheduledRun` model.

### Phase 2: Database Migration (Week 2)
- Install PostgreSQL.
- Create new schema.
- Migrate data from SQLite.
- Update Prisma datasource.
- Verify all existing features work.

### Phase 3: New Domain Entities (Week 3-4)
- Add Workspace, Agent, Deployment, Preview, BrowserSession models.
- Build service layer for each.
- Build REST API for each.
- No UI yet — API-first.

### Phase 4: Runtime Isolation (Week 5)
- Build Runtime Service (Docker API wrapper).
- Replace `spawn('bash')` with sandbox execution.
- Build container image management.
- Build snapshot/restore.

### Phase 5: Internal Git (Week 6)
- Add bare repo creation.
- Add internal commit (no GitHub).
- Add sync policies.
- Add async GitHub push.

### Phase 6: Deployment Engine (Week 7)
- Build deployment lifecycle.
- Build preview system.
- Build verification engine.
- Build atomic swap.

### Phase 7: Browser Service (Week 8)
- Build Playwright mini-service.
- Build browser session API.
- Integrate with agent API.

### Phase 8: Agent Platform (Week 9)
- Build agent identity + tokens.
- Build session management.
- Build event stream.
- Build MCP server.

### Phase 9: UI Transformation (Week 10-11)
- Replace project-centric UI with workspace-centric UI.
- Build workspace view (files, terminal, preview, browser).
- Build agent dashboard.

### Phase 10: Hardening (Week 12)
- Add authentication to all routes.
- Add rate limiting.
- Add resource scheduler.
- Add monitoring/observability.
- Add tests.

### Risks
- Phase 2 (DB migration) is highest risk — data loss.
- Phase 4 (runtime) changes execution model — all existing workflows break.
- Phase 9 (UI) is largest effort.

---

## 22. Scaling Strategy

### Single VM (Current Target)

| Resource | Limit | Strategy |
|----------|-------|----------|
| CPU | 4 cores | Max 2 concurrent containers, 1 concurrent build |
| RAM | 24GB | Max 5 active workspaces (512MB each) |
| Disk | 200GB | Image retention 10, log retention 7 days, workspace compression |
| Network | 1Gbps | Proxy all package registries through Forge cache |

### Multi-VM (Future)

```
Load Balancer
  ├── Forge App Instance 1
  ├── Forge App Instance 2
  └── Shared PostgreSQL + Redis + S3
```

- Stateless Forge app (all state in PostgreSQL + Redis).
- Runtime service per VM (Docker socket is local).
- Preview proxy per VM.
- Shared PostgreSQL + Redis for state.

### Acceptance Criteria
- Single VM handles 5 concurrent agents.
- Scaling to multi-VM requires zero code changes (only config).
- Resource scheduler prevents OOM on single VM.

---

## 23. Testing Strategy

### Existing: Zero Tests

### Target: Multi-Layer Testing

| Layer | Tool | Coverage Target |
|-------|------|----------------|
| Unit | `bun test` | 80% of service layer |
| Integration | `bun test` + test DB | All API routes |
| E2E | Playwright | 10 critical flows |
| Contract | OpenAPI + schema validation | All API responses |
| Load | `autocannon` | 100 req/sec sustained |
| Security | `npm audit` + manual | All auth routes |

### Test Structure

```
tests/
  unit/
    workspace.service.test.ts
    runtime.service.test.ts
    deployment.service.test.ts
    ...
  integration/
    api/workspaces.test.ts
    api/agents.test.ts
    api/deployments.test.ts
    ...
  e2e/
    create-project-to-deploy.spec.ts
    agent-autonomous-flow.spec.ts
    ...
  contract/
    openapi.spec.ts
  fixtures/
    test-project.zip
```

### Acceptance Criteria
- `bun test` runs in < 30 seconds.
- CI pipeline blocks on test failure.
- E2E tests cover the full agent autonomous flow.
- No test touches production data.

---

## 24. Observability Strategy

### Existing: `console.log` + `console.error`

### Target: Structured Observability

| Pillar | Implementation |
|--------|---------------|
| **Logs** | `pino` structured JSON logger, shipped to file + stdout |
| **Metrics** | `prom-client` Prometheus metrics endpoint at `/api/v1/metrics` |
| **Tracing** | OpenTelemetry traces for all API requests + command executions |
| **Audit** | `audit_logs` table (already exists, extend to all mutations) |
| **Events** | `events` table (new) — replayable timeline |
| **Health** | `/api/health` (exists, extend to check all services) |
| **Resource** | `/api/v1/metrics/resources` — CPU, RAM, disk, containers |

### Key Metrics

```
forge_commands_total{status,workspace_id}
forge_command_duration_seconds{workspace_id}
forge_deployments_total{status,project_id}
 forge_active_containers
forge_active_workspaces
forge_active_browser_sessions
forge_queue_depth{type}
forge_resource_cpu_percent
forge_resource_memory_mb
forge_resource_disk_percent
```

### Acceptance Criteria
- All logs are JSON with correlation IDs.
- Metrics endpoint returns Prometheus format.
- Traces span API → service → container.
- Audit log covers every mutation.
- Events are queryable by entity + time range.

---

## 25. Implementation Roadmap & Dependency Graph

### Dependency Graph

```
Phase 1: Stabilize (critical path, no dependencies)
├── Fix SSRF bug
├── Consolidate schedulers
├── Consolidate active Maps
├── Remove dead code
└── Remove duplicate API layer

Phase 2: PostgreSQL Migration (depends on Phase 1)
├── Install PostgreSQL
├── Migrate schema
└── Migrate data

Phase 3: Domain Entities (depends on Phase 2, can parallel with Phase 4)
├── Workspace model + service + API
├── Agent model + service + API
├── Deployment model + service + API
└── Event model + EventBus

Phase 4: Runtime Service (depends on Phase 2, can parallel with Phase 3)
├── Docker API wrapper
├── Sandbox creation
├── Command execution
└── Snapshot/restore

Phase 5: Internal Git (depends on Phase 3)
├── Bare repo creation
├── Internal commit
├── Sync policies
└── Async GitHub push

Phase 6: Deployment Engine (depends on Phase 3 + Phase 4)
├── Build pipeline
├── Preview system
├── Verification engine
└── Atomic swap

Phase 7: Browser Service (depends on Phase 4, can parallel with Phase 5+6)
├── Playwright service
├── Browser session API
└── Integration with agent

Phase 8: Agent Platform (depends on Phase 3 + Phase 4 + Phase 5)
├── Agent identity + auth
├── Session management
├── Event stream
└── MCP server

Phase 9: UI Transformation (depends on Phase 3 + Phase 8)
├── Workspace-centric UI
├── Agent dashboard
└── Preview browser

Phase 10: Hardening (depends on all above)
├── Auth on all routes
├── Rate limiting
├── Resource scheduler
├── Observability
└── Tests
```

### Parallel Tracks

| Track | Phases | Can Run In Parallel With |
|-------|--------|------------------------|
| Backend Core | 1, 2, 3 | — |
| Runtime | 4 | Track 1 (Phase 3) |
| Git | 5 | Track 2 (Phase 4, 6) |
| Browser | 7 | Track 1 (Phase 3, 5, 6) |
| UI | 9 | Nothing (needs everything) |

### Critical Path

```
Phase 1 → Phase 2 → Phase 3 → Phase 8 → Phase 9 → Phase 10
```

### Estimated Timeline

| Phase | Duration | Dependencies |
|-------|----------|-------------|
| 1. Stabilize | 2 days | None |
| 2. PostgreSQL | 1 day | Phase 1 |
| 3. Domain Entities | 4 days | Phase 2 |
| 4. Runtime Service | 3 days | Phase 2 (parallel with 3) |
| 5. Internal Git | 2 days | Phase 3 |
| 6. Deployment Engine | 3 days | Phase 3 + 4 |
| 7. Browser Service | 2 days | Phase 4 (parallel with 5+6) |
| 8. Agent Platform | 3 days | Phase 3 + 4 + 5 |
| 9. UI Transformation | 4 days | Phase 3 + 8 |
| 10. Hardening | 3 days | All above |
| **Total** | **~27 days** | |

---

## Final Note

This document represents the complete planning phase. No implementation has begun. Every deliverable has been produced with:

- Analysis of existing implementation
- Explanation of limitations
- Alternative designs considered
- Tradeoff comparison
- Justification for selected design
- Migration steps
- Risk identification
- Acceptance criteria

The implementation phase may now begin, following the dependency graph and phase order defined in Section 25.
