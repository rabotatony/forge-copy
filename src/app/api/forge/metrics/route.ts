// ============================================================
// Forge — observability / live metrics
// ============================================================
// GET /api/forge/metrics — system health + counters for a dashboard.
// ============================================================
import { db } from "@/lib/db";
import { listNodes, meshSummary } from "@/lib/forge/mesh";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let mem: any = null;
  try { const p = (process as any).memoryUsage?.(); if (p) mem = { rss: p.rss, heapUsed: p.heapUsed }; } catch {}
  let projects = 0, runs = 0, nodes: any = { online: 0, total: 0 };
  try { projects = await db.project.count(); } catch {}
  try { runs = await db.run.count(); } catch {}
  try { const n = await listNodes(); const s = meshSummary(n); nodes = { online: (s as any).online ?? 0, total: (s as any).total ?? 0 }; } catch {}
  return Response.json({
    uptime: typeof process !== "undefined" ? (process as any).uptime?.() : null,
    memory: mem,
    counts: { projects, runs },
    mesh: nodes,
    ts: Date.now(),
  });
}
