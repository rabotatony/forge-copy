// GET /api/forge/projects/[id]/github/prs
// List pull requests (open by default; ?state=closed|all to change).
import type { NextRequest } from "next/server";
import { getOctokit, listPRs, mapGitHubError } from "@/lib/forge/github";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const state = (req.nextUrl.searchParams.get("state") as "open" | "closed" | "all" | null) ?? "open";
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    const prs = await listPRs(gh.octokit, gh.creds, state);
    return ok({ prs });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
    return serverError(err);
  }
}
