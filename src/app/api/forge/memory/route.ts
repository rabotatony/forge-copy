// ============================================================
// Forge — persistent memory (long-term state for an orchestrator)
// ============================================================
// GET  /api/forge/memory          -> the memory object
// POST /api/forge/memory          -> { set?: {...}, del?: string[], clear?: true }
// Persists to disk on real compute; in-memory on edge (honest note).
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILE = "/data/forge-memory.json";
let mem: Record<string, unknown> = {};
let durable = false;
try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); durable = true; } catch { durable = false; }
function load(): Record<string, unknown> {
  if (!durable) return mem;
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(m: Record<string, unknown>) {
  mem = m;
  if (durable) { try { fs.writeFileSync(FILE, JSON.stringify(m, null, 2)); } catch {} }
}

export async function GET(): Promise<Response> {
  return Response.json({ memory: load(), durable });
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const m = load();
  if (b.clear) { save({}); return Response.json({ memory: {}, durable }); }
  if (b.set && typeof b.set === "object") Object.assign(m, b.set);
  if (Array.isArray(b.del)) for (const k of b.del) delete m[k];
  save(m);
  return Response.json({ memory: m, durable });
}
