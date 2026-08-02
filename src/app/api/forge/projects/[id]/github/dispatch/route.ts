// POST /api/forge/projects/[id]/github/dispatch
// Trigger a GitHub Actions workflow via workflow_dispatch.
// Body: { workflowId: number | string (id or filename), ref: string (branch/tag), inputs?: Record<string,string> }
import type { NextRequest } from "next/server";
import { getOctokit, triggerWorkflow, validateBranchName, mapGitHubError } from "@/lib/forge/github";
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
    const workflowId = body.workflowId ?? body.workflow_id;
    const ref = (body.ref ?? "").toString();
    // inputs must be a flat Record<string,string> — reject arrays / nested objects.
    let inputs: Record<string, string> | undefined;
    if (body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)) {
      inputs = {};
      for (const [k, v] of Object.entries(body.inputs)) {
        if (typeof v === "string" && k.length <= 100) inputs[k] = v.slice(0, 1000);
      }
      if (Object.keys(inputs).length === 0) inputs = undefined;
    }
    if (!workflowId) return fail("Missing 'workflowId'");
    if (!ref) return fail("Missing 'ref' (branch or tag to dispatch on)");
    const refErr = validateBranchName(ref);
    if (refErr) return fail(`Invalid ref: ${refErr}`);
    const gh = await getOctokit(id);
    if (!gh) return fail("GitHub not configured — set token + owner/repo", 412);
    await triggerWorkflow(gh.octokit, gh.creds, { workflowId, ref, inputs });
    return ok({ dispatched: true });
  } catch (err) {
    const m = mapGitHubError(err); return fail(m.message, m.status);
  }
}
