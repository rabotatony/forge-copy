# GLM / External-Agent <-> Forge Integration

Forge is a generic build/serve platform. It is not tied to any one app.
Any repository can be linked, synced, built and served. This document explains
how an external AI coding agent (GLM via z.ai, or anything else that commits
to GitHub) can drive Forge — and how Forge can be driven directly via its API.

There are two integration modes. They can be combined.

---

## Mode A — Agent writes to GitHub, Forge mirrors + rebuilds (recommended)

The agent keeps doing exactly what it does today (commit + push to a GitHub
repo). Forge links that repo, then mirrors every push and rebuilds the live
preview automatically.

    GLM (z.ai)  --commit/push-->  GitHub repo  --(pull)-->  Forge workspace
                                                             |
                                                             v
                                                     live rebuild + preview

### Setup
1. Link the repo — create/import the project in Forge with the repo URL,
   or use POST /api/forge/deploy-repo with { url }. Forge clones it into
   the project workspace and records repoUrl.
2. Enable live mode — POST /api/forge/projects/<id>/live { enabled: true }.
3. Trigger sync — manually via POST /api/forge/projects/<id>/sync, or
   automatically via webhook (below), or on a timer (polling fallback).

### Automatic sync via GitHub webhook (real-time)
Add a webhook on the GitHub repo pointing at your Forge node:

- Payload URL: https://<your-forge-host>/api/forge/webhooks/github
- Content type: application/json
- Events: Just the push event
- Secret (recommended): set a value, then define FORGE_GITHUB_WEBHOOK_SECRET
  with the same value on the Forge node.

On every push, Forge finds all linked projects matching the pushed repo and
runs git fetch + git pull; if new commits landed it schedules a live rebuild.
The preview link updates within seconds.

### Polling fallback (no webhook needed)
If you cannot add a webhook (e.g. Forge is behind NAT with no public URL),
call POST /api/forge/projects/<id>/sync on a timer (cron) — or use the
Forge Mesh agent on any machine to poll. This is the zero-config path.

---

## Mode B — Agent calls Forge's API directly (no GitHub round-trip)

Forge exposes a file-edit API that feeds straight into the live loop. An agent
that can make HTTP calls can write files directly and watch the preview update.

    PUT /api/forge/projects/<id>/files/update
    Content-Type: application/json

    { "files": { "src/app/page.tsx": "...full file content..." } }

When live mode is enabled, each update schedules a debounced rebuild and the
preview reflects the change in about 2 seconds. No git, no GitHub, no CI.

Other useful endpoints:
- GET  /api/forge/projects/<id>/live — live state + preview URL
- POST /api/forge/projects/<id>/live — { enabled, buildCommand?, outputDir? }
- POST /api/forge/projects/<id>/live?action=build — force a rebuild now
- GET  /api/forge/projects/<id>/preview/** — the served output (live link)
- GET  /api/forge/github/repos — list repos available for linking (global token)

---

## Configuration reference

| Setting | Where | Purpose |
|---------|-------|---------|
| GITHUB_TOKEN | Forge settings (GitHub panel) or env | Clone/pull + account repo listing |
| GITHUB_OWNER / GITHUB_REPO | settings or env | Fallback when a project has no repoUrl |
| FORGE_GITHUB_WEBHOOK_SECRET | env on the Forge node | Validate webhook signatures |

Tokens can be stored encrypted in the Forge settings store (.forge-settings.json,
AES-256-GCM) via the GitHub settings panel, or provided via environment variables.

---

## End-to-end loop (Mode A)

    1. GLM edits code and pushes to <repo>
    2. GitHub fires push webhook -> /api/forge/webhooks/github
    3. Forge verifies signature, matches repoUrl -> project
    4. git fetch + pull into workspace
    5. new commits? -> scheduleLiveBuild(projectId)
    6. build runs on the Forge node (detects Next/Vite/static)
    7. preview link serves fresh output

The same pipeline works for any repo/agent/stack — nothing here is specific
to one project. Shoshana is just the first project running through it.
