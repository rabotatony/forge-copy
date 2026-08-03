// ============================================================
// Forge — project GitHub sync endpoint (project-agnostic)
// GET  /api/forge/projects/[id]/sync — sync state + repo info
// POST /api/forge/projects/[id]/sync — pull now { rebuild?: bool }
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import { db } from "@/lib/db";
import { isGitRepo, revParseHead } from "@/lib/forge/git";
import { getSyncState, syncProject } from "@/lib/forge/github-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({
      where: { id },
      select: { id: true, name: true, repoUrl: true, repoBranch: true, extractedPath: true, lastPulledAt: true },
    });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const state = getSyncState(id);
    const workspace = project.extractedPath;
    const isRepo = Boolean(workspace && fs.existsSync(workspace) && isGitRepo(workspace));
    const localHead = isRepo ? await revParseHead(workspace) : null;

    return Response.json({
      projectId: id,
      repoUrl: project.repoUrl,
      repoBranch: project.repoBranch,
      isGitRepo: isRepo,
      localHead,
      lastPulledAt: project.lastPulledAt,
      state,
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
    const body = (await request.json().catch(() => ({}))) as { rebuild?: boolean };
    const result = await syncProject(id, { rebuild: body.rebuild });
    if (!result.ok) {
      return Response.json({ ok: false, ...result }, { status: 400 });
    }
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
