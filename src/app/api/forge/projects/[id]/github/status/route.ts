// GET /api/forge/projects/[id]/github/status
// Aggregated GitHub status: PRs + recent Actions runs + workflow count.
// Single round-trip for the UI so the "GitHub" tab doesn't fan out 3 calls.
import type { NextRequest } from "next/server";
import { getOctokit, listPRs, listWorkflowRuns, listWorkflows, checkWriteAccess, getDefaultBranch, mapGitHubError } from "@/lib/forge/github";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const gh = await getOctokit(id);
    if (!gh) return ok({ configured: false, prs: [], runs: [], workflows: [], canPush: false, defaultBranch: null });
    const [prs, runs, workflows, canPush, defaultBranch] = await Promise.all([
      listPRs(gh.octokit, gh.creds, "open").catch(() => []),
      listWorkflowRuns(gh.octokit, gh.creds, 10).catch(() => []),
      listWorkflows(gh.octokit, gh.creds).catch(() => []),
      checkWriteAccess(gh.octokit, gh.creds).catch(() => false),
      getDefaultBranch(gh.octokit, gh.creds).catch(() => null),
    ]);
    return ok({ configured: true, owner: gh.creds.owner, repo: gh.creds.repo, canPush, defaultBranch, prs, runs, workflows });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
    return serverError(err);
  }
}
