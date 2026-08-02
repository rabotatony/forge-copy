// POST /api/forge/projects/[id]/github/pr
// Open a pull request from head branch into base (defaults to repo's default branch).
import type { NextRequest } from "next/server";
import { getOctokit, createPR, validateBranchName, mapGitHubError } from "@/lib/forge/github";
import { ok, fail } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const title = (body.title ?? "").toString();
    const head = (body.head ?? "").toString();
    const base = body.base ? String(body.base) : undefined;
    const prBody = (body.body ?? "").toString();
    if (!title) return fail("Missing 'title'");
    if (!head) return fail("Missing 'head' (source branch)");
    const headErr = validateBranchName(head);
    if (headErr) return fail(`Invalid head: ${headErr}`);
    if (base) {
      const baseErr = validateBranchName(base);
      if (baseErr) return fail(`Invalid base: ${baseErr}`);
    }
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    const pr = await createPR(gh.octokit, gh.creds, { title, body: prBody, head, base });
    return ok(pr);
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
  }
}
