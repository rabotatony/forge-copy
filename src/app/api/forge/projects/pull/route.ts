// ============================================================
// Forge — pull-based ingestion (system fetches the source itself)
// ============================================================
// POST /api/forge/projects/pull  { url, name? }
// Instead of the CLIENT uploading a huge archive through the request
// body (which trips Workers body limits), the SYSTEM pulls the source
// from a URL and streams it straight to storage. Forge owns the whole
// flow: fetch -> store -> register -> ready to deploy. Handles any size.
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { writeStorageStream } from "@/lib/forge/storage-io";
import { sourceZipPath } from "@/lib/forge/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function guessName(url: string): string {
  try { const p = new URL(url).pathname.split("/").filter(Boolean); return p[p.length - 2] || p[p.length - 1] || "project"; } catch { return "project"; }
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const url = String(b.url ?? "");
  if (!url) return Response.json({ error: "url required" }, { status: 400 });

  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "forge-pull/1.0" } });
    if (!res.ok) return Response.json({ error: `source fetch failed: ${res.status}` }, { status: 502 });
    if (!res.body) return Response.json({ error: "no body" }, { status: 502 });

    const name = String(b.name ?? guessName(url));
    const isZip = url.toLowerCase().includes(".zip");
    const fileName = isZip ? `${name}.zip` : `${name}.tar.gz`;

    const project = await db.project.create({
      data: {
        name,
        fileName,
        extractedPath: "",
        fileSize: Number(res.headers.get("content-length") || 0),
        fileCount: 0,
        kind: "node",
        detection: JSON.stringify({ sourceUrl: url }),
        repoUrl: url.includes("github.com") ? url : null,
      },
    });

    // Stream the fetched archive straight into storage (no buffering).
    const archivePath = isZip
      ? sourceZipPath(project.id)
      : sourceZipPath(project.id).replace(/source\.zip$/, "source.tar.gz");
    await writeStorageStream(archivePath, res.body as unknown as ReadableStream);

    return Response.json({
      id: project.id, name, sourceUrl: url,
      deferred: true,
      note: "System pulled and stored the source; ready to analyze/deploy.",
    }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
