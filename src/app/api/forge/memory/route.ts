// ============================================================
// Forge — persistent memory (durable on D1/SQLite, edge + server)
// ============================================================
// GET  /api/forge/memory            -> { memory: {key:value,...} }
// POST /api/forge/memory            -> { set?: {...}, del?: string[], clear?: true }
// Backed by the Memory table so it survives across sessions and
// across BOTH the Workers link and real-compute deployments.
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function loadAll(): Promise<Record<string, unknown>> {
  try {
    const rows = await db.memory.findMany();
    const out: Record<string, unknown> = {};
    for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
    return out;
  } catch { return {}; }
}

export async function GET(): Promise<Response> {
  return Response.json({ memory: await loadAll(), durable: true });
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  try {
    if (b.clear) { await db.memory.deleteMany(); return Response.json({ memory: {}, durable: true }); }
    if (b.set && typeof b.set === "object") {
      for (const [k, v] of Object.entries(b.set)) {
        await db.memory.upsert({ where: { key: k }, update: { value: JSON.stringify(v) }, create: { key: k, value: JSON.stringify(v) } });
      }
    }
    if (Array.isArray(b.del)) { for (const k of b.del) { await db.memory.delete({ where: { key: k } }).catch(() => {}); } }
    return Response.json({ memory: await loadAll(), durable: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
