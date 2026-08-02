// ============================================================
// Forge — run details
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const run = await db.run.findUnique({
      where: { id },
      include: {
        artifacts: { orderBy: { createdAt: 'asc' } },
        logs: { select: { id: true }, take: 1 },
      },
    });
    if (!run) {
      return Response.json({ error: 'Run not found' }, { status: 404 });
    }

    const logCount = await db.logLine.count({ where: { runId: id } });

    return Response.json({
      run: {
        id: run.id,
        projectId: run.projectId,
        workflow: run.workflow,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        trigger: run.trigger,
        matrixValues: run.matrixValues,
        matrixIndex: run.matrixIndex,
        matrixTotal: run.matrixTotal,
        reRunOfId: run.reRunOfId,
        concurrencyGroup: run.concurrencyGroup,
        label: run.label,
        timeoutMs: run.timeoutMs,
        requiresApproval: run.requiresApproval,
      },
      logCount,
      artifacts: run.artifacts.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        mime: a.mime,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
