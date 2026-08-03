# Forge - Sovereign Cloudflare Control

Forge can manage Cloudflare directly - Workers, Pages, DNS and custom
domains - with no external CI. This is what lets Forge deploy and serve
any project the way Netlify/Vercel do, but under your own control.

## Provider module
src/lib/forge/cloudflare.ts wraps the Cloudflare v4 API:

| Area | Functions |
|------|-----------|
| Workers | listWorkers, uploadWorker, deleteWorker, getWorkersSubdomain, ensureWorkersSubdomain, workerPublicUrl |
| Zones/DNS | listZones, findZoneByName, listDnsRecords, upsertDnsRecord, deleteDnsRecord |
| Custom domains | listWorkerCustomDomains, attachWorkerCustomDomain |
| Pages | listPagesProjects, ensurePagesProject, deletePagesProject |
| Summary | getAccountSummary (one-call capability snapshot) |

Credentials come from CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
(env or explicit args).

## API
/api/forge/cloudflare
- GET  - account capability summary (workers, workers.dev subdomain, zones, pages)
- POST - action dispatch: summary, ensure-subdomain, list-workers, delete-worker,
  list-zones, list-dns, upsert-dns, delete-dns, list-pages, ensure-pages,
  delete-pages, attach-domain

## Deploy paths
- Static site -> Cloudflare Pages via cf-pages.ts (direct upload).
- Full app with API routes -> Cloudflare Workers. Build with
  @opennextjs/cloudflare (opennextjs-cloudflare build) to produce
  .open-next/worker.js + assets, then upload via uploadWorker.
  This is exactly how Shoshana was deployed (shoshana.rabotatony.workers.dev).

## Custom domain recipe
    1. ensure-subdomain                       # one-time workers.dev subdomain
    2. upsert-dns  {zoneName, type:CNAME, name:app.example.com, content:worker-url}
    3. attach-domain {scriptName, hostname:app.example.com}

## Notes
- Free tier: Pages 500 deploys/month, Workers free request quota, DNS unlimited.
- The workers.dev subdomain is account-wide; register once, reuse for all workers.
- Calls are idempotent where possible (upsertDnsRecord, ensure helpers).
