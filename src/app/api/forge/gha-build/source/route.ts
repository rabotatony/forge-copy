// ============================================================
// Forge — source delivery for GitHub-runner builds
// ============================================================
// GET /api/forge/gha-build/source?token=<signed>
// Streams a project's uploaded source.zip from storage (R2 on
// Workers / fs elsewhere) so a free GitHub runner can download
// and build it. The token is an HMAC-signed projectId — no stored
// state, works on every runtime (see signSourceToken).
// ============================================================
import type { NextRequest } from "next/server";
import { verifySourceToken } from "@/lib/forge/gha-build";
import { readStorageFile } from "@/lib/forge/storage-io";
import { sourceZipPath } from "@/lib/forge/storage";
import { fail } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    if (!token) return fail("missing token", 401);

    const projectId = await verifySourceToken(token);
    if (!projectId) return fail("bad or expired source token", 401);

    let data = await readStorageFile(sourceZipPath(projectId));
    let kind: "zip" | "tar.gz" = "zip";
    if (!data || data.length === 0) {
      data = await readStorageFile(sourceZipPath(projectId).replace(/source\.zip$/, "source.tar.gz"));
      kind = "tar.gz";
    }
    if (!data || data.length === 0) {
      return fail("no uploaded source archive for this project (git projects build via codeload)");
    }

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": kind === "zip" ? "application/zip" : "application/gzip",
        "Content-Disposition": `attachment; filename="${projectId}-source.${kind}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "source delivery failed", 500);
  }
}
