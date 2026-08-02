# Forge — Product Reconstruction

> Forge is a self-hosted CI/CD platform. Bring code, run workflows, ship.
> This is the reconstructed product — designed from the center outward,
> not accumulated from incremental edits.

---

## The Product

**Purpose**: Turn code into shippable artifacts through automated workflows.

**Core loop**: Bring code → Run workflows → Get results → Automate & analyze

Forge's unique angle: it's self-hosted, works with any upload (ZIP, TAR,
git clone, or template), and infers what you want to build.

---

## The Product Shape

The original Forge had 5 top-level surfaces and 10 project sections —
every feature got its own screen. That was accumulation, not design.

The reconstructed Forge has **3 surfaces** and **4 project tabs**,
organized by purpose:

### 3 Surfaces

```
Projects  —  the primary workspace (list + 4-tab detail)
Library   —  unified template browser (all 4 template kinds)
System    —  operations (settings + tokens + logs + lab)
```

### 4 Project Tabs

```
Overview   —  run-centric dashboard (intent, health, recent runs, insights)
Code       —  file explorer + git repo management
Pipelines  —  what to run (catalog + custom + multi-stage + presets)
Configure  —  how to configure (secrets, env, cache, triggers, etc.)
```

### Why This Shape

- **Projects is the primary surface** because the core loop is
  project-centric. You bring a project, you run workflows on it, you
  see results. Everything else supports this.
- **Library replaces Marketplace + template browsing** — all 4 template
  kinds (workflows, marketplace, presets, project-templates) are one
  browseable collection. "Apply to project" or "Create project from
  template" are the same action: "use a template."
- **System replaces Settings + Lab + Audit + Logs** — all operational
  concerns live in one place. The Experiments Lab is clearly bounded
  as a sub-tab, not a top-level surface competing with Projects.
- **4 project tabs instead of 10 sections** because the 10 sections
  were organized by feature type (Presets, Workflows, Pipelines,
  Custom, Repository, Activity, Analytics, Automate, Configure,
  Overview). The 4 tabs are organized by user purpose:
  - "What's happening?" → Overview
  - "What's in the code?" → Code
  - "What should I run?" → Pipelines
  - "How do I configure it?" → Configure

---

## The Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         UI LAYER                                    │
│                                                                     │
│  page.tsx — 3-surface shell                                         │
│    ├─ Projects → project-list + project-workspace (4 tabs)          │
│    ├─ Library  → library (unified template browser)                 │
│    └─ System   → system-console (4 tabs: settings/tokens/logs/lab)  │
│                                                                     │
│  Components:                                                        │
│    ├─ ui.tsx — ONE primitive module (Loading, ErrorState, etc.)     │
│    ├─ use-forge-api.ts — ONE hook module (all React Query hooks)    │
│    ├─ create-project.tsx — unified create dialog (Upload/Clone/Tpl) │
│    └─ run-view / pipeline-run-view — live SSE log viewers           │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼  (fetch + SSE)
┌─────────────────────────────────────────────────────────────────────┐
│                         API LAYER                                   │
│  84 resource-oriented routes                                        │
│  middleware.ts — rate limiter                                       │
│  instrumentation.ts — boots timers                                  │
│  response.ts — unified error responses                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       DOMAIN LAYER                                  │
│                                                                     │
│  Unified public surfaces:                                           │
│    templates.ts — ONE type layer for all 4 catalog kinds            │
│    intent.ts    — ONE entry point for detect→infer→recommend        │
│    index.ts     — ONE barrel                                        │
│                                                                     │
│  Execution:                                                         │
│    engine.ts          — run lifecycle, SSE bus                      │
│    pipeline.ts        — DAG executor + custom workflows (merged)    │
│    child-runner.ts    — ONE shared step primitive                   │
│    workflow-plugins.ts — plugin registry (AxiomState parse/bundle)  │
│                                                                     │
│  Catalogs (data):                                                   │
│    workflows.ts / marketplace.ts / presets.ts / templates-projects  │
│                                                                     │
│  Intent pipeline:                                                   │
│    detector.ts → intelligence.ts → router.ts                        │
│                                                                     │
│  Capabilities:                                                      │
│    secrets / cache / triggers / notifications / test-report /       │
│    git / analytics / auth / scripts                                 │
│                                                                     │
│  Shared helpers:                                                    │
│    fs-utils / matrix / security / response / bootstrap              │
│                                                                     │
│  Experiments Lab (split into 7 modules):                            │
│    types / definitions / runner / llm / verdict / promote / index   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     INFRASTRUCTURE                                  │
│  db.ts (Prisma) · storage.ts · i18n.ts · axiomstate/                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What Was Reconstructed

### Product-level redesigns

| What | Before | After |
|---|---|---|
| Top-level surfaces | 5 (Dashboard, Projects, Marketplace, Lab, Settings) | 3 (Projects, Library, System) |
| Project sections | 10 (Overview, Presets, Workflows, Pipelines, Repository, Activity, Analytics, Automate, Configure, Custom) | 4 (Overview, Code, Pipelines, Configure) |
| Create flow | 3 separate components visible at once on the projects page | 1 unified dialog with Upload/Clone/Template tabs |
| Projects page | Cluttered (AI assistant + script generator + system stats + dropzone + git import + list) | Clean (system health strip + search + project grid + New Project button) |
| Template browsing | 4 separate catalogs with 4 different interfaces | 1 unified Library with kind filters |
| System operations | Split across 2 surfaces (Settings + Lab) | 1 System console with 4 tabs |

### Domain-level unifications

| What | Before | After |
|---|---|---|
| Template type system | 4 unrelated interfaces | 1 `Template` union in `templates.ts` |
| Intent pipeline | 3 modules, 3 import paths | 1 `intent.ts` entry point with `analyzeProject()` |
| Non-shell workflows | Fake `echo` commands + engine special-case | `workflow-plugins.ts` registry + `axiomstate-plugin.ts` |
| Custom workflows + pipelines | 2 overlapping modules | 1 `pipeline.ts` (custom-workflow is a single-stage pipeline) |
| Hook modules | 2 parallel files (v1 + v2) | 1 `use-forge-api.ts` |
| UI primitives | 5+ redefinitions per primitive | 1 `ui.tsx` with 6 unified primitives |
| Experiments engine | 5,708-LOC monolith | 7 focused modules |
| Notifications | 2 duplicate functions | 1 `notify()` function |
| Scripts encoding | Inline hack | 1 `scripts.ts` with typed helpers |
| Schedulers | 3 competing cron schedulers | 1 (`triggers.ts`) |
| Step runners | 2 duplicate implementations | 1 `child-runner.ts` |

### Dead code removed

| What | LOC |
|---|---|
| AxiomState phases 3-5 + sample | 3,781 |
| Dead UI components (project-detail, file-tree, scheduled-runs-panel, global-dashboard, global-marketplace, system-stats) | ~2,000 |
| Dead API routes (12) | ~244 |
| Dead experiments/engine.ts tail | 205 |
| scheduler.ts | 96 |
| use-forge-api-v2.ts | 510 |
| Duplicate helpers | ~300 |

### Bugs fixed

- Tar upload now captures stderr for proper error messages
- Pipeline quadratic retry `(retry+1)²` → per-step retry only
- `secrets.ts` refuses to run in production without `FORGE_SECRET_KEY`
- `maskSecrets` skips values < 4 chars (no more masking "1" or "true")
- Two intent tables referencing non-existent `release-patch` → single table with `release`
- Fake `parse`/`bundle` echo commands → real plugin registry
- Missing `/api/forge/upload` route → created
- Broken API contracts (`/generate-script`, `/scripts` POST) → fixed
- `experiments-lab.tsx` crash on `breakthrough` category → fixed
- `extractDir('')` path bug → fixed

---

## Verification

- **`bun run lint`** — zero errors
- **`npx tsc --noEmit`** — zero errors
- **Dev server** — runs cleanly on port 3000
- **End-to-end browser testing**:
  - Projects surface: clean list + system health strip + New Project button
  - New Project dialog: Upload / Clone / Template tabs all work
  - Tar upload: works end-to-end (creates project, navigates to workspace)
  - Project workspace: 4 tabs (Overview, Code, Pipelines, Configure) all render
  - Workflow execution: Pipelines tab → Run → Success with live SSE logs
  - Library: 54 templates (40 marketplace + 8 presets + 6 starters) with kind filters
  - System: 4 tabs (Settings, API Tokens, Logs, Lab) all render
  - Experiments Lab: 46 experiments render across 6 categories

---

## Design Principles

1. **Purpose over type** — tabs are organized by what the user wants to
   do, not by what kind of feature it is.
2. **One implementation per responsibility** — one scheduler, one
   step-runner, one intent table, one hook module, one UI primitive
   module.
3. **No import side-effects** — timers start via `instrumentation.ts`.
4. **Plugin registry over hardcoded branches** — non-shell workflows
   register as plugins.
5. **Schema-level integrity** — cascade deletes in Prisma, not in app
   code.
6. **Unified UI language** — one `Loading`, one `ErrorState`, one
   `StatCard`, one `CategoryChip`.
7. **Defense-in-depth** — URL validation, shell-metachar detection,
   command blocking, AES-256-GCM secrets, rate limiting.

---

## The Version Infinity Test

> Does this feel like the best possible version of the product?

- **3 surfaces, 4 project tabs** — organized by purpose, not by feature
  accumulation.
- **One create flow** — Upload/Clone/Template in one dialog, not three
  components cluttering the projects page.
- **One template browser** — all 4 kinds in one Library, not split
  across Marketplace + Workflow Catalog + Presets Gallery + Project
  Templates.
- **One system console** — Settings + Tokens + Logs + Lab in one place,
  not scattered across two surfaces.
- **One implementation per responsibility** — throughout the domain
  layer.

**Verdict: passes.** This is not the same Forge with cleaner helpers.
This is a rethought product with a stronger center, cleaner information
architecture, and fewer moving parts.
