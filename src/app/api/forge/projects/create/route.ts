// ============================================================
// Forge — create an empty project shell (for large/batch ingest)
// ============================================================
// POST /api/forge/projects/create
//   { name, fileName?, sourceUrl?, description? }
// Creates the project row immediately (visible in the UI) with
// status "pending-ingest"; files arrive via:
//   POST /api/forge/projects/{id}/ingest  (runner-powered), or
//   POST /api/forge/projects/{id}/files   (direct batches)
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { created, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail("name is required");
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : name;
    const sourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim() ? body.sourceUrl.trim() : undefined;

    const project = await db.project.create({
      data: {
        name,
        fileName,
        extractedPath: "",
        fileSize: 0,
        fileCount: 0,
        kind: "unknown",
        detection: JSON.stringify({ status: "pending-ingest", ...(sourceUrl ? { sourceUrl } : {}) }),
      },
    });

    return created({
      id: project.id,
      name: project.name,
      status: "pending-ingest",
      next: `POST /api/forge/projects/${project.id}/ingest` + (sourceUrl ? "" : " with { sourceUrl }"),
    });
  } catch (e) {
    return serverError(e);
  }
}
