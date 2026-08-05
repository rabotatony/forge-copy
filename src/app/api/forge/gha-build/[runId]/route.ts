// ============================================================
// Forge — status / logs / artifacts of a GitHub-runner build
// ============================================================
// GET /api/forge/gha-build/{ghaRunId}?logs=1
//   -> run status + jobs, optional tail of logs, artifacts when done
// ============================================================
import type { NextRequest } from "next/server";
import { getGhaRunStatus, getGhaJobLogs, getGhaArtifacts } from "@/lib/forge/gha-build";
import { ok, fail, serverError } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await params;
    const id = Number(runId);
    if (!Number.isFinite(id) || id <= 0) return fail("invalid run id");

    const status = await getGhaRunStatus(id);

    let logs: string | undefined;
    if (request.nextUrl.searchParams.get("logs") === "1") {
      for (const job of status.jobs) {
        if (job.id) {
          const text = await getGhaJobLogs(job.id);
          if (text) logs = (logs ?? "") + text;
        }
      }
      if (logs && logs.length > 60000) logs = logs.slice(-60000);
    }

    const artifacts = status.status === "completed" ? await getGhaArtifacts(id) : [];
    return ok({ ...status, logs: logs ?? null, artifacts });
  } catch (e) {
    return serverError(e);
  }
}
