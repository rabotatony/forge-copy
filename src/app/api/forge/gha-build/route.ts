// ============================================================
// Forge — dispatch a build to free GitHub runners
// ============================================================
// POST /api/forge/gha-build
// Body (one source form):
//   { projectId?: string,          // Forge project (repo or uploaded ZIP)
//     repoSlug?: "owner/repo",     // public GitHub repo -> codeload tarball
//     sourceUrl?: string,          // or any tarball/zip URL (precedence)
//     ref?: string,                // branch (codeload default main)
//     buildCmd?: string,           // explicit build command (else auto-detect)
//     runId?: string }             // Forge run id for correlation
//
// projectId resolution:
//   - project.repoUrl set (github) -> codeload tarball of that repo
//   - otherwise (uploaded ZIP)     -> signed source URL served by Forge
//     (GET /api/forge/gha-build/source), streamed from R2 / fs.
//
// The build executes on GitHub's free runners (public repos) via
// forge-remote-build.yml — real Linux compute, zero cost, zero
// extra accounts.
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dispatchGhaBuild, signSourceToken } from "@/lib/forge/gha-build";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseGitHubSlug(repoUrl: string): string | null {
  const m1 = repoUrl.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?$/i);
  return m1 ? m1[1] : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const forgeRunId =
      typeof body.runId === "string" && body.runId ? body.runId : `forge-${Date.now()}`;
    const buildCmd = typeof body.buildCmd === "string" ? body.buildCmd : "";
    const ref = typeof body.ref === "string" && body.ref ? body.ref : undefined;
    const origin = new URL(request.url).origin;

    let sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    let sourceKind: "tar" | "zip" = "tar";

    // ---- source form 1: Forge project -------------------------------
    if (!sourceUrl && typeof body.projectId === "string" && body.projectId) {
      const project = await db.project.findUnique({ where: { id: body.projectId } });
      if (!project) return fail("project not found");

      const slug = project.repoUrl ? parseGitHubSlug(project.repoUrl) : null;
      if (slug && (!project.repoProvider || project.repoProvider === "github")) {
        sourceUrl = `https://codeload.github.com/${slug}/tar.gz/refs/heads/${
          project.repoBranch ?? ref ?? "main"
        }`;
        sourceKind = "tar";
      } else {
        // Uploaded archive — Forge itself serves the source to the runner.
        const token = await signSourceToken(project.id);
        sourceUrl = `${origin}/api/forge/gha-build/source?token=${encodeURIComponent(token)}`;
        sourceKind = (project.fileName ?? "").toLowerCase().endsWith(".zip") ? "zip" : "tar";
      }
    }

    // ---- source form 2: public repo slug ----------------------------
    if (!sourceUrl) {
      const repoSlug = typeof body.repoSlug === "string" ? body.repoSlug.trim() : "";
      if (repoSlug && /^[\w.-]+\/[\w.-]+$/.test(repoSlug)) {
        sourceUrl = `https://codeload.github.com/${repoSlug}/tar.gz/refs/heads/${ref ?? "main"}`;
        sourceKind = "tar";
      }
    }

    if (!sourceUrl) {
      return fail(
        "provide projectId (Forge project), repoSlug (public 'owner/repo') or sourceUrl (archive URL)",
      );
    }

    const result = await dispatchGhaBuild({
      forgeRunId,
      sourceUrl,
      sourceKind,
      buildCmd,
      publicUrl: origin,
      ref,
    });
    return ok({
      forgeRunId,
      dispatched: result.dispatched,
      ghaRunId: result.ghaRunId,
      runUrl: result.runUrl,
      workflowRepo: result.workflowRepo,
      sourceKind,
    });
  } catch (e) {
    return serverError(e);
  }
}
