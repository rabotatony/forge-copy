// ============================================================
// Forge Sites — deploy built files, get a UNIQUE link
// ============================================================
// POST /api/forge/sites  { name, files: { "index.html": "..." } }
// Stores files in R2 under sites/{siteId}/ and returns a unique URL
// served by the separate forge-sites worker (no main-worker bloat).
// ============================================================
import type { NextRequest } from "next/server";
import { writeStorageFile } from "@/lib/forge/storage-io";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SITES_BASE = "https://forge-sites.rabotatony.workers.dev";

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const files = (b.files ?? {}) as Record<string, string>;
  const names = Object.keys(files);
  if (names.length === 0) return Response.json({ error: "files required" }, { status: 400 });
  const siteId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  for (const p of names) {
    await writeStorageFile(`sites/${siteId}/${p.replace(/^\//, "")}`, String(files[p]));
  }
  return Response.json({
    siteId,
    name: String(b.name ?? "site"),
    url: `${SITES_BASE}/sites/${siteId}/`,
    fileCount: names.length,
  }, { status: 201 });
}
