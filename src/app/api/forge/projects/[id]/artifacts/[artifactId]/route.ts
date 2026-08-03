// ============================================================
// Forge — single artifact
// GET    /api/forge/projects/[id]/artifacts/[artifactId] — details
// DELETE /api/forge/projects/[id]/artifacts/[artifactId] — remove file + row
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, notFound, serverError } from "@/lib/forge/response";
import { audit } from "@/lib/forge/audit";
import { deleteArtifact } from "@/lib/forge/artifact-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
): Promise<Response> {
  try {
    const { id, artifactId } = await params;
    const artifact = await db.artifact.findFirst({ where: { id: artifactId, projectId: id } });
    if (!artifact) return notFound("Artifact not found");
    return ok(artifact);
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
): Promise<Response> {
  try {
    const { id, artifactId } = await params;
    const artifact = await db.artifact.findFirst({ where: { id: artifactId, projectId: id } });
    if (!artifact) return notFound("Artifact not found");
    await deleteArtifact(id, artifactId);
    await audit("artifact.deleted", "project", id, "api", { artifactId, name: artifact.name });
    return ok({ deleted: artifactId });
  } catch (err) {
    return serverError(err);
  }
}
