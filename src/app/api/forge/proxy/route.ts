// ============================================================
// Forge — network proxy (gives an orchestrator outbound reach)
// ============================================================
// GET /api/forge/proxy?url=https://...
// Fetches any URL server-side and returns status + body.
// Works even on edge (Workers allow outbound fetch), so Forge
// becomes the "network hands" for a headless orchestrator.
// ============================================================
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return Response.json({ error: "url required" }, { status: 400 });
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "forge-proxy/1.0" } });
    const text = await r.text();
    return Response.json({
      status: r.status,
      ok: r.ok,
      type: r.headers.get("content-type"),
      bytes: text.length,
      body: text.slice(0, 20000),
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
