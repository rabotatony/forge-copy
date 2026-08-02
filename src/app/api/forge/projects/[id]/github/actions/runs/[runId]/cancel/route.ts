// POST /api/forge/projects/[id]/github/actions/runs/[runId]/cancel
// Cancel a running GitHub Actions workflow run.
import type { NextRequest } from "next/server";
import { getOctokit, cancelWorkflowRun, mapGitHubError } from "@/lib/forge/github";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  try {
    const { id, runId: runIdStr } = await params;
    const runId = parseInt(runIdStr, 10);
    if (!Number.isFinite(runId) || runId <= 0 || !/^\d+$/.test(runIdStr)) return fail("Invalid runId");
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    await cancelWorkflowRun(gh.octokit, gh.creds, runId);
    return ok({ canceled: true, runId });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
    return serverError(err);
  }
}
