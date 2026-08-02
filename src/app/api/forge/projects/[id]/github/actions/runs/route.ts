// GET /api/forge/projects/[id]/github/actions/runs
// List recent GitHub Actions workflow runs.
import type { NextRequest } from "next/server";
import { getOctokit, listWorkflowRuns, mapGitHubError } from "@/lib/forge/github";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const parsed = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    const runs = await listWorkflowRuns(gh.octokit, gh.creds, limit);
    return ok({ runs });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
    return serverError(err);
  }
}
