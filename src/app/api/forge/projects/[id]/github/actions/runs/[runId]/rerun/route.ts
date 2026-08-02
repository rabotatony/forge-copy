// POST /api/forge/projects/[id]/github/actions/runs/[runId]/rerun
// Re-run a GitHub Actions workflow run. ?failed=true to only rerun failed jobs.
import type { NextRequest } from "next/server";
import { getOctokit, rerunWorkflowRun, rerunFailedJobs, mapGitHubError } from "@/lib/forge/github";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  try {
    const { id, runId: runIdStr } = await params;
    const runId = parseInt(runIdStr, 10);
    if (!Number.isFinite(runId) || runId <= 0 || !/^\d+$/.test(runIdStr)) return fail("Invalid runId");
    const onlyFailed = req.nextUrl.searchParams.get("failed") === "true";
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    if (onlyFailed) await rerunFailedJobs(gh.octokit, gh.creds, runId);
    else await rerunWorkflowRun(gh.octokit, gh.creds, runId);
    return ok({ reran: true, runId, failedOnly: onlyFailed });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
    return serverError(err);
  }
}
