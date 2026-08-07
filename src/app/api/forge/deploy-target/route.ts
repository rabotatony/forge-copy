// ============================================================
// Forge — deploy-target adapters (provision real compute anywhere)
// ============================================================
// POST /api/forge/deploy-target
//   { provider: "fly", token, app?, image? }
// Creates a Fly.io app + machine running the given image (default:
// the Forge image on ghcr). Gives Forge the power to spin up REAL
// compute on demand — the bridge from "edge" to "sovereign server".
//
// The token is passed per-request (never stored in the repo).
// ============================================================
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FLY = "https://api.fly.io";

async function fly(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(FLY + path, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, json, text: text.slice(0, 500) };
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const provider = String(b.provider ?? "fly");
  const token = String(b.token ?? "");
  if (!token) return Response.json({ error: "token required (passed per-request, never stored)" }, { status: 400 });

  if (provider === "fly") {
    const app = String(b.app ?? "forge-sovereign-" + Math.random().toString(36).slice(2, 6));
    const image = String(b.image ?? "ghcr.io/rabotatony/forge:latest");
    // 1) create app
    const created = await fly(token, "POST", "/v1/apps", { name: app, org: "personal" });
    if (!created.ok && created.status !== 409) {
      return Response.json({ provider, step: "create-app", ...created });
    }
    // 2) create machine running the image
    const mach = await fly(token, "POST", `/v1/apps/${app}/machines`, {
      config: {
        image,
        env: { PORT: "3000", DATABASE_URL: "file:/data/forge.db" },
        services: [{ protocol: "tcp", internal_port: 3000, ports: [{ port: 80, handlers: ["http"] }, { port: 443, handlers: ["http", "tls"] }] }],
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 },
      },
      start: true,
    });
    return Response.json({
      provider, app, image,
      url: `https://${app}.fly.dev`,
      createApp: created.status,
      machine: mach.status,
      machineJson: mach.json ? { id: mach.json.id, state: mach.json.state } : mach.text,
    });
  }

  return Response.json({ error: "unknown provider: " + provider }, { status: 400 });
}
