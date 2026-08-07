// ============================================================
// Forge — UI telemetry (a "browser" for the orchestrator)
// ============================================================
// The client reports which panels rendered / crashed in real time.
// An external tool / AI can GET this to "see" the live UI state —
// the closest thing to a browser for a headless orchestrator.
//
// POST /api/forge/telemetry  { type, panel?, error? }
// GET  /api/forge/telemetry  -> recent events
// ============================================================
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type Ev = { t: number; type: string; panel?: string; error?: string };
// In-memory ring buffer (per isolate). On a real server this could be
// persisted to DB; on edge it lives for the isolate's lifetime.
const ring: Ev[] = [];
function push(e: Ev) { ring.push(e); if (ring.length > 200) ring.shift(); }

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  push({ t: Date.now(), type: String(b.type ?? "event"), panel: b.panel, error: b.error });
  return Response.json({ ok: true });
}

export async function GET(): Promise<Response> {
  return Response.json({ events: ring.slice(-100), count: ring.length });
}
