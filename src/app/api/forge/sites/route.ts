// ============================================================
// Forge Sites — deploy built files and get a UNIQUE link
// ============================================================
// POST /api/forge/sites  { name, files: { "index.html": "..." } }
// Stores the files in storage under sites/{siteId}/ and returns a
// unique URL (/s/{siteId}/) that Forge serves. This is Forge's own
// deploy: each deploy gets its own unique link.
// ============================================================
import type { NextRequest } from "next/server";
import { writeStorageFile } from "@/lib/forge/storage-io";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const files = (b.files ?? {}) as Record<string, string>;
  const names = Object.keys(files);
  if (names.length === 0) return Response.json({ error: "files required" }, { status: 400 });
  const siteId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  for (const p of names) {
    await writeStorageFile(`sites/${siteId}/${p}`, String(files[p]));
  }
  const hasIndex = names.some((n) => n === "index.html" || n.endsWith("/index.html"));
  return Response.json({
    siteId,
    name: String(b.name ?? "site"),
    url: `/s/${siteId}/`,
    fileCount: names.length,
    entrypoint: hasIndex ? "index.html" : names[0],
  }, { status: 201 });
}
