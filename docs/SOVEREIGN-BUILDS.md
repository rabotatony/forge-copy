# Sovereign Builds — Forge without external CI

Forge builds, publishes and deploys projects **entirely on its own
infrastructure** (the local node or any registered mesh node). No
GitHub Actions, no Netlify builds, no credits, no quotas.

## Pipeline

    project workspace (storage/projects/<id>/extract)
        |
        v
    1. guardConfigSanity()  - quarantines *.config.* files that import
                              packages missing in this mode (restorable,
                              see .forge-quarantine/RESTORE.md)
    2. detectToolchain()    - bun/pnpm/yarn/npm + next/vite/astro/...
    3. runSovereignBuild()  - install + build via hardened child-runner
                              (live logs, secret masking, timeouts,
                              blocked-command policy)
    4. publish              - target "cf-pages": direct-upload deployment
                              to Cloudflare Pages (free tier: unlimited
                              sites/bandwidth, 500 deploys/month)

## API

    POST /api/forge/projects/<id>/sovereign-build
    {
      "target": "cf-pages",        // or "none" for build-only
      "cfProject": "shoshana",     // optional; default = slug(name)
      "env": { "BUILD_APK": "1" }  // optional overrides
    }

Next.js projects default to BUILD_STATIC=1 (site export). Pass
{"env": {"BUILD_APK": "1"}} for the APK export mode instead.

## Node configuration

| env var | meaning |
|---|---|
| CLOUDFLARE_API_TOKEN | token with Account -> Cloudflare Pages: Edit |
| CLOUDFLARE_ACCOUNT_ID | target Cloudflare account |

Store them in the node's .env (or, for per-project isolation, in
Forge's secret vault and inject via env at call time).

## Why this beats external CI

| | GitHub Actions / Netlify | Forge sovereign build |
|---|---|---|
| quota | minutes/credits per month | none — your hardware |
| limits | private-repo Pages, build caps | none |
| visibility | logs on their infra | logs stream through Forge UI |
| failure policy | you fix it | guard quarantines + audit trail |
| multi-target | separate pipelines | one call: web/APK/desktop |

## The Shoshana lesson

capacitor.config.ts imported @capacitor/cli (an APK-mode-only dev
dependency). Site builds type-checked it and died. The guard detects
exactly this class of failure for any project and moves the offending
file aside — builds proceed, nothing is lost.
