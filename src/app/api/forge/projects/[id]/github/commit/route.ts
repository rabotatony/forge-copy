// POST /api/forge/projects/[id]/github/commit
// Commit one or more files to a branch via the GitHub Contents API
// (auto-commits per file). For large diffs prefer the git CLI push path.
import type { NextRequest } from "next/server";
import { getOctokit, commitFilesViaContentsApi, validateBranchName, mapGitHubError } from "@/lib/forge/github";
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
    const files: Array<{ path: string; content: string }> = Array.isArray(body.files) ? body.files : [];
    const branch = (body.branch ?? "").toString();
    const message = (body.message ?? "").toString();
    if (files.length === 0) return fail("Missing 'files' array");
    if (!branch) return fail("Missing 'branch'");
    if (!message) return fail("Missing 'message'");
    const branchErr = validateBranchName(branch);
    if (branchErr) return fail(`Invalid branch: ${branchErr}`);
    // Sanitize file paths: reject absolute, traversal, empty.
    for (const f of files) {
      if (!f.path || f.path.startsWith("/") || f.path.includes("..") || f.path.includes("\\\\")) {
        return fail(`Invalid file path: ${f.path || "(empty)"}`);
      }
    }
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    const result = await commitFilesViaContentsApi(
      gh.octokit,
      gh.creds,
      files,
      branch,
      message,
    );
    return ok({ lastCommitSha: result.lastCommitSha, commitCount: result.commitCount });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
  }
}
