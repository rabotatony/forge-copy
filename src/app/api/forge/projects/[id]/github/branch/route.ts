// POST /api/forge/projects/[id]/github/branch
// Create a new branch off the repo's default branch (or a specified base).
import type { NextRequest } from "next/server";
import { getOctokit, createBranch, validateBranchName, mapGitHubError } from "@/lib/forge/github";
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
    const name = (body.name ?? "").toString().trim();
    const base = body.base ? String(body.base) : undefined;
    if (!name) return fail("Missing 'name' field");
    const nameErr = validateBranchName(name);
    if (nameErr) return fail(nameErr);
    if (base) {
      const baseErr = validateBranchName(base);
      if (baseErr) return fail(`Invalid base: ${baseErr}`);
    }
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    const result = await createBranch(gh.octokit, gh.creds, name, base);
    return ok({ ref: result.ref, sha: result.sha });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
  }
}
