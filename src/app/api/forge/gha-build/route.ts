// ============================================================
// Forge — dispatch a build to free GitHub runners
// ============================================================
// POST /api/forge/gha-build
// Body:
//   { repoSlug?: "owner/repo",   // public repo -> codeload tarball
//     sourceUrl?: string,        // or any tarball URL (takes precedence)
//     ref?: string,              // branch for codeload (default main)
//     buildCmd?: string,         // explicit build command (else auto-detect)
//     runId?: string }           // Forge run id for correlation
//
// The build executes on GitHub's free runners (public repos) via
// forge-remote-build.yml — real Linux compute, zero cost, zero
// extra accounts.
// ============================================================
import type { NextRequest } from "next/server";
import { dispatchGhaBuild } from "@/lib/forge/gha-build";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const forgeRunId =
      typeof body.runId === "string" && body.runId ? body.runId : `forge-${Date.now()}`;
    const buildCmd = typeof body.buildCmd === "string" ? body.buildCmd : "";
    const ref = typeof body.ref === "string" && body.ref ? body.ref : undefined;

    let sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    if (!sourceUrl) {
      const repoSlug = typeof body.repoSlug === "string" ? body.repoSlug.trim() : "";
      if (!repoSlug || !/^[\w.-]+\/[\w.-]+$/.test(repoSlug)) {
        return fail("provide sourceUrl (tarball URL) or repoSlug (public 'owner/repo')");
      }
      sourceUrl = `https://codeload.github.com/${repoSlug}/tar.gz/refs/heads/${ref ?? "main"}`;
    }

    const result = await dispatchGhaBuild({ forgeRunId, sourceUrl, buildCmd, ref });
    return ok({
      forgeRunId,
      dispatched: result.dispatched,
      ghaRunId: result.ghaRunId,
      runUrl: result.runUrl,
      workflowRepo: result.workflowRepo,
    });
  } catch (e) {
    return serverError(e);
  }
}
