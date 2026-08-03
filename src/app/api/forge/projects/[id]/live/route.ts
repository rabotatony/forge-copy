// ============================================================
// Forge — Live mode control
// GET  /api/forge/projects/[id]/live              — state + preview URL
// POST /api/forge/projects/[id]/live              — configure / toggle
//      body: { enabled?, buildCommand?, outputDir? }
// POST /api/forge/projects/[id]/live?action=build — rebuild now
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getLiveState,
  setLiveState,
  detectLivePlan,
  runLiveBuild,
} from "@/lib/forge/live";
import { audit } from "@/lib/forge/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const state = getLiveState(id);
    const plan = detectLivePlan(project.extractedPath);
    const previewUrl = `/api/forge/projects/${id}/preview/`;

    return Response.json({
      projectId: id,
      state: { ...state, lastBuildLog: state.lastBuildLog.slice(-20_000) },
      detectedPlan: plan,
      previewUrl,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const action = request.nextUrl.searchParams.get("action");
    if (action === "build") {
      const state = await runLiveBuild(id);
      return Response.json({
        ok: true,
        state: { ...state, lastBuildLog: state.lastBuildLog.slice(-20_000) },
      });
    }

    const body = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      buildCommand?: string | null;
      outputDir?: string | null;
    };

    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.buildCommand !== undefined) {
      const cmd = body.buildCommand === null ? null : String(body.buildCommand).slice(0, 500);
      if (cmd !== null && /[`$;&|<>]/.test(cmd)) {
        return Response.json({ error: "buildCommand contains forbidden shell characters" }, { status: 400 });
      }
      patch.buildCommand = cmd;
    }
    if (body.outputDir !== undefined) {
      const od = body.outputDir === null ? null : String(body.outputDir).replace(/[^a-zA-Z0-9._/-]/g, "").slice(0, 200);
      if (od && (od.startsWith("/") || od.includes(".."))) {
        return Response.json({ error: "Invalid outputDir" }, { status: 400 });
      }
      patch.outputDir = od;
    }

    const state = setLiveState(id, patch);
    await audit("live.config", "project", id, "api", { enabled: state.enabled });

    if (body.enabled === true) {
      runLiveBuild(id).catch(() => {});
    }

    return Response.json({
      ok: true,
      state: { ...state, lastBuildLog: state.lastBuildLog.slice(-20_000) },
      previewUrl: `/api/forge/projects/${id}/preview/`,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
