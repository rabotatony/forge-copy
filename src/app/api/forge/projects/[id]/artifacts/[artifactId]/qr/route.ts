// ============================================================
// Forge — QR code for artifact install
// GET /api/forge/projects/[id]/artifacts/[artifactId]/qr
// Generated LOCALLY with the `qrcode` package — zero external
// services. Scanning installs/downloads the artifact from this
// very Forge node.
// ============================================================
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, notFound, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
): Promise<Response> {
  try {
    const { id, artifactId } = await params;
    const artifact = await db.artifact.findFirst({ where: { id: artifactId, projectId: id } });
    if (!artifact) return notFound("Artifact not found");

    const downloadUrl = `${request.nextUrl.origin}/api/forge/projects/${id}/artifacts/${artifactId}/download`;
    let QR: any;
    try {
      const mod: any = await import("qrcode");
      QR = mod.default ?? mod;
    } catch {
      return fail("qrcode package not installed on this node — run `bun install`", 501);
    }
    const png: Buffer = await QR.toBuffer(downloadUrl, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Forge-QR-Target": downloadUrl,
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
