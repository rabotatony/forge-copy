// GET /api/forge/projects/[id]/github/actions/workflows
// List GitHub Actions workflow definitions in .github/workflows/.
import type { NextRequest } from "next/server";
import { getOctokit, listWorkflows, mapGitHubError } from "@/lib/forge/github";
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
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    const workflows = await listWorkflows(gh.octokit, gh.creds);
    return ok({ workflows });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
    return serverError(err);
  }
}
