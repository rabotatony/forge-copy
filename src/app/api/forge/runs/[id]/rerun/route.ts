// ============================================================
// Forge — re-run a run (with optional parameter overrides)
// ============================================================
// POST /api/forge/runs/[id]/rerun
//   body: { env?: Record<string, string>, timeoutMs?: number, retry?: number }
//   → { runId } (a new run that's a re-run of the original)
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { startRunExtended } from '@/lib/forge/engine';
import { getWorkflow } from '@/lib/forge/workflows';
import type { Detection } from '@/lib/forge/detector';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as {
      env?: Record<string, string>;
      timeoutMs?: number;
      retry?: number;
    };

    const originalRun = await db.run.findUnique({
      where: { id },
      select: {
        projectId: true,
        workflow: true,
        trigger: true,
        matrixValues: true,
        timeoutMs: true,
        retryCount: true,
        requiresApproval: true,
      },
    });

    if (!originalRun) {
      return Response.json({ error: 'Run not found' }, { status: 404 });
    }

    const project = await db.project.findUnique({ where: { id: originalRun.projectId } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    const workflow = getWorkflow(originalRun.workflow);
    if (!workflow) {
      return Response.json({ error: `Workflow ${originalRun.workflow} not found` }, { status: 400 });
    }

    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: 'unknown', hints: [] } as Detection; }

    // Start a new run, inheriting settings from the original + applying overrides.
    const { runId } = await startRunExtended({
      projectId: originalRun.projectId,
      workflow: originalRun.workflow,
      trigger: 'manual',
      secrets: workflow.secrets ?? [],
      env: body.env ?? {},
      retry: body.retry ?? originalRun.retryCount ?? workflow.defaultRetry,
      timeoutMs: body.timeoutMs ?? originalRun.timeoutMs ?? workflow.defaultTimeoutMs,
      requiresApproval: originalRun.requiresApproval,
      reRunOfId: id,
      label: `Re-run of ${id.slice(-8)}`,
    });

    return Response.json({ runId, reRunOf: id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
