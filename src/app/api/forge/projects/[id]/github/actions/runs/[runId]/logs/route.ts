// GET /api/forge/projects/[id]/github/actions/runs/[runId]/logs
// Download a GitHub Actions workflow run's logs as a ZIP archive.
// Streams the ZIP straight from GitHub to the client — no RAM buffering.
import type { NextRequest } from "next/server";
import { getOctokit, downloadWorkflowRunLogs, mapGitHubError } from "@/lib/forge/github";
import { fail } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  try {
    const { id, runId: runIdStr } = await params;
    const runId = parseInt(runIdStr, 10);
    if (!Number.isFinite(runId) || runId <= 0) return fail("Invalid runId");
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    const { stream, size } = await downloadWorkflowRunLogs(gh.octokit, gh.creds, runId);
    const headers: Record<string, string> = {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="run-${runId}-logs.zip"`,
    };
    if (size !== null) headers["Content-Length"] = String(size);
    // Stream the body straight through — no buffering into RAM.
    return new Response(stream as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    const m = mapGitHubError(err);
    return fail(m.message, m.status);
  }
}
