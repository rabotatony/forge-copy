# Forge Mesh

Forge Mesh turns Forge into the **brain of a private cloud assembled from
free / scavenged machines** — community VPSes, free-tier containers, old
laptops, even Android phones running Termux. No single vendor owns your
infrastructure, so no single vendor can shut you down or meter you out.

```
[Your devices - phone / browser]
        |  (lightweight commands only)
        v
+-----------------------------+
|   Forge Control Plane       |  <- this app (one of the nodes, or any)
|   * node registry           |
|   * task queue              |
|   * deploy placement        |
+------+----------+-----------+
       | outbound | outbound        <- agents dial OUT; no inbound ports,
       v          v                    works behind NAT / CGNAT / mobile data
+----------+ +----------+ +----------+
| VPS node | | free-tier| | Termux   |
| (static+ | | container| | phone    |
|  node)   | | (node)   | | (static) |
+----------+ +----------+ +----------+
```

## Concepts

- **Node** — any machine running `agent.sh`. Registers once, gets a slug +
  secret. Kinds: `generic | vps | termux | koyeb | render | cloudflare | home`.
  Capabilities: `static | node | docker | tunnel`.
- **Task** — a unit of work pushed to a node: `deploy_static`,
  `deploy_node`, `run_command` (opt-in on the agent).
- **Heartbeat** — the agent polls `POST /api/forge/nodes/[id]/heartbeat`
  every ~20s. Online = seen within 90s. Tasks ride on the heartbeat
  response, results ride back through the same outbound channel.

## Security model

- Node secrets are 256-bit random values; the control plane stores only the
  sha256 hash. Plaintext is shown **exactly once** at registration.
- Comparison is timing-safe. Secrets travel only in the
  `x-forge-node-secret` header over HTTPS.
- `run_command` tasks are rejected by the agent unless
  `FORGE_AGENT_ALLOW_COMMANDS=1` is explicitly set.
- Static deploys verify an optional `sha256` checksum and sanitize
  site/version names; releases land in immutable directories and are swapped
  with an atomic symlink (zero downtime); the newest 5 releases are kept for
  instant rollback.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/forge/nodes` | GET | list nodes + mesh summary |
| `/api/forge/nodes` | POST | register node - returns `{ node, secret }` once |
| `/api/forge/nodes/[id]` | GET | node + recent tasks |
| `/api/forge/nodes/[id]` | DELETE | remove node + tasks |
| `/api/forge/nodes/[id]/tasks` | POST | enqueue task (`kind`, `payload`) |
| `/api/forge/nodes/[id]/heartbeat` | POST | agent heartbeat - claims tasks |
| `/api/forge/nodes/[id]/tasks/[taskId]` | POST | agent reports result |

## Adding a node

1. Register it: `POST /api/forge/nodes` with `{ "name": "my-vps", "kind": "vps" }`
   and copy the `secret` (shown once).
2. On the machine (Linux or Termux):

```bash
FORGE_URL=https://your-forge.example.com \
NODE_SLUG=my-vps \
NODE_SECRET=<secret> \
bash <(curl -fsSL https://your-forge.example.com/mesh/bootstrap-node.sh)
```

3. Within ~30s the node appears `online` in `GET /api/forge/nodes`.

The bootstrap installs `jq` if missing, downloads the agent (served by Forge
itself from `/mesh/agent.sh`), writes `~/.forge-node/agent.env` with locked
permissions, and starts the agent in the background.

## Deploying to a node

```bash
curl -X POST $FORGE/api/forge/nodes/my-vps/tasks \
  -H 'content-type: application/json' \
  -d '{
    "kind": "deploy_static",
    "payload": {
      "site": "shoshana",
      "version": "v12",
      "url": "https://your-artifact-storage/shoshana-v12.tgz",
      "sha256": "<hash>"
    }
  }'
```

The agent downloads the release, verifies the checksum, extracts it to
`~/.forge-node/sites/<site>/releases/<version>/`, atomically points
`current` at it, and prunes old releases.

## Roadmap

- [x] Node registry + secret auth
- [x] Outbound agent protocol (NAT/CGNAT/mobile-data friendly)
- [x] Static release deploys with atomic swap + rollback set
- [ ] Mesh panel in the Forge UI (register/monitor/rollback)
- [ ] `deploy_node` execution (Next.js standalone behind a port)
- [ ] Scheduler: placement by capability + health, automatic failover
- [ ] Release distribution: control-plane-hosted artifact storage
- [ ] Wire Forge workflows to mesh deploys (`deploy` step)

## Mapping free sources to node kinds

| Free source | Node kind | Typical caps |
|---|---|---|
| Community/free VPS | `vps` | static, node |
| Koyeb free web service | `koyeb` | node |
| Render free service | `render` | node (mind sleep) |
| Cloudflare edge | `cloudflare` | static (via Pages/Workers) |
| Old laptop / home box | `home` | static, node, docker |
| Android + Termux | `termux` | static, node |
