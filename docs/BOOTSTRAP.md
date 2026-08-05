# Node Bootstrap - one command to a live Forge node

Phase A of Forge Mesh: turn any machine into a working Forge node.
Supports Debian/Ubuntu/Alpine and Android+Termux (no root, cellular ok).

## One command

```bash
curl -fsSL -o bootstrap-forge.sh https://raw.githubusercontent.com/rabotatony/forge-copy/main/scripts/bootstrap-forge.sh
bash bootstrap-forge.sh
```

What it does:

1. Detects environment (Linux / Termux)
2. Installs git + bun (node fallback on Termux)
3. Clones forge-copy into ~/forge
4. Writes .env + .forge/env.sh (DATABASE_URL SQLite at .forge/forge.db, PORT)
5. bun install + prisma db push
6. bun run build (standalone production bundle)
7. Starts: systemd forge.service on Linux, nohup + termux-wake-lock on Termux
8. Health check on :3000

## Optional env vars

| Var | Default | Purpose |
|---|---|---|
| FORGE_REPO | rabotatony/forge-copy | where to clone from |
| FORGE_DIR | ~/forge | install dir |
| FORGE_PORT | 3000 | HTTP port |
| FORGE_DEV | 0 | 1 = dev mode, skip build |

## Public exposure - expose-forge.sh

```bash
bash scripts/expose-forge.sh
```

- Default: Cloudflare Quick Tunnel - no account, no config,
  instant trycloudflare.com URL. Works behind CGNAT/NAT/cellular
  because the tunnel dials OUT.
- FORGE_EXPOSE=caddy - direct bind on 80/443 via the repo Caddyfile
  (needs a public IP).

## Logs and control

```bash
sudo systemctl status forge && sudo journalctl -u forge -f   # systemd
tail -f ~/forge/.forge/forge.log                             # termux/background
```

## Register the node in the mesh

```bash
curl -fsSL https://raw.githubusercontent.com/rabotatony/forge-copy/main/public/mesh/bootstrap-node.sh | FORGE_URL=http://127.0.0.1:3000 bash
```

## Verified

- bash -n passes on both scripts
- Matches real package.json: build = standalone, start = bun .next/standalone/server.js
- db:push = prisma db push --accept-data-loss
- DB at stable absolute path (.forge/forge.db), independent of standalone CWD

## One-command sovereign stack

```bash
git clone https://github.com/rabotatony/forge-copy forge-src
bash forge-src/scripts/forge-up.sh
```

`forge-up.sh`:

1. Provisions every missing environment via `scripts/forge-env.sh`
   (idempotent): git/curl/unzip, bun, node, python3 + uv (Python runtime
   builds), docker (optional).
2. Starts Forge — Docker path preferred (persistent volumes,
   `restart: unless-stopped`, docker daemon enabled at boot), native
   bootstrap otherwise (systemd `forge.service`, Restart=always).
3. Waits for the health check on `:3000/api/health`.

Management:

```bash
bash scripts/forge-up.sh status   # health + container/service state
bash scripts/forge-up.sh logs     # tail logs (docker / file / journal)
bash scripts/forge-up.sh stop     # stop Forge
bash scripts/forge-up.sh env      # re-provision environments only
```

Auto-start survives reboots on both paths; nothing phones home and no
paid service is required.
