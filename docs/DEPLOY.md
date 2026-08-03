# Forge Deploy — self-hosted deployments (Phase 1)

> **תקציר בעברית:** Forge עכשיו יודע לפרסם אתרים בעצמו — בלי Netlify, בלי Vercel,
> בלי מגבלות build minutes. כל deploy מעתיק את תוצאת הבנייה ל-release חדש,
> מחליף symlink באופן אטומי (zero downtime), ו-Caddy מגיש את האתר עם HTTPS
> אוטומטי. Rollback = החזרת ה-symlink לגרסה קודמת. הכל רץ על השרת שלך.

## How it works

```
publish:  <sourceDir>  --copy-->  sites/<slug>/releases/<version>/
                                        |
                               atomic symlink swap
                                        v
                          sites/<slug>/current --> releases/<version>
                                        |
                         Caddy snippet -> HTTPS -> visitors
```

- Every deploy creates an **immutable release** (YYYYMMDD-HHMMSS-xxxx)
- The `current` symlink is swapped **atomically** — zero downtime
- Old releases are pruned automatically (`FORGE_DEPLOY_KEEP`, default 10)
- **Rollback** re-points the symlink at any previous release (instant)
- Each site gets a generated Caddy snippet with automatic TLS

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/forge/projects/[id]/environments` | List environments |
| POST | `/api/forge/projects/[id]/environments` | Create environment `{name, description?, requiresApproval?}` |
| GET | `/api/forge/projects/[id]/deployments` | Deployment history |
| POST | `/api/forge/projects/[id]/deployments` | Publish now |
| GET | `/api/forge/deployments/[id]` | Details + on-disk releases |
| DELETE | `/api/forge/deployments/[id]` | Remove record |
| POST | `/api/forge/deployments/[id]/rollback` | Roll back to this deployment |

`POST .../deployments` body:

```json
{
  "environmentId": "<env id>",
  "source": "workspace",
  "runId": null,
  "outputDir": "dist"
}
```

- `source`: `workspace` (the project's extracted working tree) or `run` (a run's artifact dir, requires `runId`)
- `outputDir`: optional subdir of the source — `dist` / `out` / `build` / `public` (path-traversal guarded)

UI: `<DeploymentsPanel projectId={project.id} />` — environments, one-click deploy, live URL, history, rollback.

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `FORGE_SITES_ROOT` | `<cwd>/storage/sites` | Where published sites live |
| `FORGE_CADDY_SITES_DIR` | `<cwd>/caddy/sites-enabled` | Generated Caddy snippets |
| `FORGE_DOMAIN` | — | Base domain → `https://<slug>.<domain>` |
| `FORGE_DEPLOY_KEEP` | `10` | Releases kept per site |
| `FORGE_CADDY_RELOAD_CMD` | — | e.g. `systemctl reload caddy` |

## Server setup (once)

1. Wildcard DNS: `*.forge.example.com → A <server-ip>`
2. Forge env: `FORGE_DOMAIN=forge.example.com`, `FORGE_CADDY_SITES_DIR=/etc/caddy/sites-enabled`, `FORGE_CADDY_RELOAD_CMD="systemctl reload caddy"`, `FORGE_SITES_ROOT=/srv/forge/sites`
3. System Caddyfile: `import /etc/caddy/sites-enabled/*.caddy`
4. Caddy obtains Let's Encrypt certs per `<slug>.forge.example.com` automatically

## Hosting an existing site (e.g. migrating off Netlify)

1. Create the project in Forge (upload the site folder/ZIP, or clone its repo)
2. Create a `production` environment
3. Deploy with `outputDir` pointing at the static files (root, `dist`, `out`…)
4. Done — the site is served from your server; Netlify is out of the loop

## Deploying from a workflow (automation)

Add a final shell step to any build workflow:

```sh
curl -fsS -X POST "$FORGE_URL/api/forge/projects/$FORGE_PROJECT_ID/deployments" \
  -H 'Content-Type: application/json' \
  -d '{"environmentId":"'"$FORGE_ENV_ID"'","outputDir":"dist"}'
```

Or point a webhook/cron trigger at that pipeline — push → build → deploy, fully self-hosted.

## Phase 2 roadmap

- Preview deployments per branch/PR (`pr-123.<slug>.<domain>`)
- Custom domains per environment with on-demand TLS
- Dynamic apps (Node/Next via `mode: 'app'` reverse proxy + PM2/Docker)
- Deploy gates wired to environment `requiresApproval`
