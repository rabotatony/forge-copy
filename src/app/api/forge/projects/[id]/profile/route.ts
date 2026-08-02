import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { profileProject } from "@/lib/forge/profiler";
import type { Detection } from "@/lib/forge/detector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: "unknown", hints: [] } as Detection; }
    const profile = profileProject(project.extractedPath, detection);
    return Response.json(profile);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
