// ============================================================
// Forge — artifact streaming download
// GET /api/forge/projects/[id]/artifacts/[artifactId]/download
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { notFound, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
): Promise<Response> {
  try {
    const { id, artifactId } = await params;
    const artifact = await db.artifact.findFirst({ where: { id: artifactId, projectId: id } });
    if (!artifact || !artifact.path) return notFound("Artifact not found");
    if (!fs.existsSync(artifact.path)) return notFound("Artifact file missing on disk");

    const nodeStream = fs.createReadStream(artifact.path);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk) => controller.enqueue(chunk));
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });
    const fileName = path.basename(artifact.path);
    return new Response(webStream, {
      headers: {
        "Content-Type": artifact.mime || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(artifact.size),
        "X-Forge-Sha256": artifact.sha256 ?? "",
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
