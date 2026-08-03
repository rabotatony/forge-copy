// ============================================================
// Forge — publish artifact to the rolling GitHub Release
// POST /api/forge/projects/[id]/artifacts/[artifactId]/publish
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, notFound, serverError } from "@/lib/forge/response";
import { audit } from "@/lib/forge/audit";
import { publishToRelease } from "@/lib/forge/artifact-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
): Promise<Response> {
  try {
    const { id, artifactId } = await params;
    const artifact = await db.artifact.findFirst({ where: { id: artifactId, projectId: id } });
    if (!artifact) return notFound("Artifact not found");
    const res = await publishToRelease(id, artifactId);
    await audit("artifact.published", "project", id, "api", { artifactId, releaseUrl: res.releaseUrl });
    return ok(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/token not configured/i.test(msg)) return fail(msg, 409);
    return serverError(err);
  }
}
