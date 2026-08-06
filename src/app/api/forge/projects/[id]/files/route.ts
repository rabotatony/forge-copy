// ============================================================
// Forge — batch file ingestion (runner -> Forge)
// ============================================================
// POST /api/forge/projects/{id}/files
// Header: x-forge-token: <signed source token for this project>
// Body:
//   { files: [{ path, b64 }] }                 — one batch of files
//   { done: true, paths: [...], keyFiles: {...}, fileSize? }
//                                              — finalize: detection
//                                                + row update
// Designed for the free plan: each call is small (<= ~8 MB body).
// ============================================================
import type { NextRequest } from "next/server";
import path from "node:path";
import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/forge/response";
import { writeStorageFile } from "@/lib/forge/storage-io";
import { extractDir } from "@/lib/forge/storage";
import { verifySourceToken } from "@/lib/forge/gha-build";
import { detectFromManifest } from "@/lib/forge/project-detect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BATCH_FILES = 250;
const MAX_BATCH_BYTES = 12 * 1024 * 1024; // decoded bytes

function safePath(p: string): string | null {
  if (typeof p !== "string") return null;
  const norm = p.replace(/\\\\/g, "/").replace(/^\\/+/, "");
  if (!norm || norm.includes("..") || path.isAbsolute(norm)) return null;
  return norm;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const token = request.headers.get("x-forge-token") ?? "";
    const tokenProject = await verifySourceToken(token);
    if (tokenProject !== id) return fail("bad token", 401);

    const project = await db.project.findUnique({ where: { id } });
    if (!project) return fail("project not found");

    const body = (await request.json().catch(() => ({}))) as {
      files?: Array<{ path: string; b64: string }>;
      done?: boolean;
      paths?: string[];
      keyFiles?: Record<string, string>;
      fileSize?: number;
    };

    // ---- batch of files ----
    if (Array.isArray(body.files) && body.files.length > 0) {
      if (body.files.length > MAX_BATCH_FILES) return fail(`batch too large (> ${MAX_BATCH_FILES} files)`);
      const baseDir = extractDir(id);
      let bytes = 0;
      for (const f of body.files) {
        const rel = safePath(f.path);
        if (!rel) return fail(`unsafe path: ${String(f.path).slice(0, 80)}`);
        const data = Buffer.from(f.b64 ?? "", "base64");
        bytes += data.length;
        if (bytes > MAX_BATCH_BYTES) return fail("batch too large (> 12 MB decoded)");
        await writeStorageFile(path.posix.join(baseDir, rel), data);
      }
      return ok({ received: body.files.length });
    }

    // ---- finalize ----
    if (body.done) {
      const paths = Array.isArray(body.paths) ? body.paths.map(safePath).filter((p): p is string => !!p) : [];
      const keyFiles = body.keyFiles && typeof body.keyFiles === "object" ? body.keyFiles : {};
      const { kind, detection } = detectFromManifest(paths, keyFiles);
      await db.project.update({
        where: { id },
        data: {
          extractedPath: extractDir(id),
          fileCount: paths.length,
          kind,
          detection: JSON.stringify(detection),
          ...(typeof body.fileSize === "number" ? { fileSize: body.fileSize } : {}),
        },
      });
      return ok({ finalized: true, fileCount: paths.length, kind, framework: detection.framework ?? null });
    }

    return fail("send { files: [...] } or { done: true, paths, keyFiles }");
  } catch (e) {
    return serverError(e);
  }
}
