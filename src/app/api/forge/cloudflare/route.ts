// ============================================================
// Forge — Cloudflare control API (sovereign)
// ============================================================
// GET  /api/forge/cloudflare          — account capability summary
// POST /api/forge/cloudflare          — action dispatch
//   summary, ensure-subdomain, list-workers, delete-worker,
//   list-zones, list-dns, upsert-dns, delete-dns,
//   list-pages, ensure-pages, delete-pages, attach-domain
// ============================================================
import type { NextRequest } from "next/server";
import {
  getCfCredentials, getAccountSummary, listWorkers, deleteWorker,
  ensureWorkersSubdomain, getWorkersSubdomain, listZones, findZoneByName,
  listDnsRecords, upsertDnsRecord, deleteDnsRecord, listPagesProjects,
  ensurePagesProject, deletePagesProject, attachWorkerCustomDomain,
} from "@/lib/forge/cloudflare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function credsOrFail(): ReturnType<typeof getCfCredentials> {
  return getCfCredentials();
}

function noCreds(): Response {
  return Response.json(
    { error: "Cloudflare not configured. Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID." },
    { status: 409 },
  );
}

export async function GET(): Promise<Response> {
  try {
    const creds = credsOrFail();
    if (!creds) return noCreds();
    const summary = await getAccountSummary(creds);
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const creds = credsOrFail();
    if (!creds) return noCreds();
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const action = String(body.action ?? "");

    switch (action) {
      case "summary": {
        const summary = await getAccountSummary(creds);
        return Response.json({ ok: true, ...summary });
      }
      case "ensure-subdomain": {
        const sub = await ensureWorkersSubdomain(creds, body.subdomain ? String(body.subdomain) : undefined);
        return Response.json({ ok: true, subdomain: sub });
      }
      case "list-workers": {
        const workers = await listWorkers(creds);
        const sub = await getWorkersSubdomain(creds);
        return Response.json({ ok: true, workers, workersSubdomain: sub });
      }
      case "delete-worker": {
        if (!body.scriptName) return Response.json({ error: "scriptName required" }, { status: 400 });
        await deleteWorker(creds, String(body.scriptName));
        return Response.json({ ok: true, deleted: String(body.scriptName) });
      }
      case "list-zones": {
        const zones = await listZones(creds);
        return Response.json({ ok: true, zones });
      }
      case "list-dns": {
        let zoneId = body.zoneId ? String(body.zoneId) : "";
        if (!zoneId && body.zoneName) {
          const z = await findZoneByName(creds, String(body.zoneName));
          if (!z) return Response.json({ error: "zone not found" }, { status: 404 });
          zoneId = z.id;
        }
        if (!zoneId) return Response.json({ error: "zoneId or zoneName required" }, { status: 400 });
        const records = await listDnsRecords(creds, zoneId);
        return Response.json({ ok: true, zoneId, records });
      }
      case "upsert-dns": {
        let zoneId = body.zoneId ? String(body.zoneId) : "";
        if (!zoneId && body.zoneName) {
          const z = await findZoneByName(creds, String(body.zoneName));
          if (!z) return Response.json({ error: "zone not found" }, { status: 404 });
          zoneId = z.id;
        }
        if (!zoneId || !body.type || !body.name || !body.content) {
          return Response.json({ error: "zoneId/zoneName + type + name + content required" }, { status: 400 });
        }
        const rec = await upsertDnsRecord({
          creds, zoneId,
          type: body.type, name: String(body.name), content: String(body.content),
          proxied: typeof body.proxied === "boolean" ? body.proxied : true,
        });
        return Response.json({ ok: true, recordId: rec.id });
      }
      case "delete-dns": {
        if (!body.zoneId || !body.recordId) return Response.json({ error: "zoneId + recordId required" }, { status: 400 });
        await deleteDnsRecord(creds, String(body.zoneId), String(body.recordId));
        return Response.json({ ok: true });
      }
      case "list-pages": {
        const pages = await listPagesProjects(creds);
        return Response.json({ ok: true, pages });
      }
      case "ensure-pages": {
        if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
        await ensurePagesProject(creds, String(body.name));
        return Response.json({ ok: true, name: String(body.name) });
      }
      case "delete-pages": {
        if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
        await deletePagesProject(creds, String(body.name));
        return Response.json({ ok: true, deleted: String(body.name) });
      }
      case "attach-domain": {
        if (!body.scriptName || !body.hostname) return Response.json({ error: "scriptName + hostname required" }, { status: 400 });
        const d = await attachWorkerCustomDomain(creds, String(body.scriptName), String(body.hostname));
        return Response.json({ ok: true, id: d.id });
      }
      default:
        return Response.json({ error: "unknown action: " + action }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
