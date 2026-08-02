// Forge — analytics: project overview dashboard
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { failurePatterns } from '@/lib/forge/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;

    const runs = await db.run.findMany({
      where: { projectId: id },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });

    const total = runs.length;
    const successCount = runs.filter(r => r.status === 'success').length;
    const failedCount = runs.filter(r => r.status === 'failed').length;
    const canceledCount = runs.filter(r => r.status === 'canceled').length;
    const activeCount = runs.filter(r => r.status === 'running' || r.status === 'queued' || r.status === 'waiting_approval').length;
    const durations = runs.filter(r => r.durationMs !== null).map(r => r.durationMs!);
    const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const successRate = total > 0 ? successCount / total : 0;

    // Group by workflow.
    const byWorkflow = new Map<string, { count: number; success: number }>();
    for (const r of runs) {
      const entry = byWorkflow.get(r.workflow) ?? { count: 0, success: 0 };
      entry.count++;
      if (r.status === 'success') entry.success++;
      byWorkflow.set(r.workflow, entry);
    }
    const runsByWorkflow = Array.from(byWorkflow.entries()).map(([workflow, v]) => ({
      workflow,
      count: v.count,
      successRate: v.count > 0 ? v.success / v.count : 0,
    }));

    const recentRuns = runs.slice(0, 10).map(r => ({
      id: r.id,
      workflow: r.workflow,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      trigger: r.trigger,
      label: r.label,
      matrixValues: r.matrixValues,
    }));

    const topFailures = await failurePatterns(id, 5);

    return Response.json({
      totalRuns: total,
      successRate,
      avgDurationMs,
      activeRuns: activeCount,
      runsByWorkflow,
      runsByStatus: {
        success: successCount,
        failed: failedCount,
        canceled: canceledCount,
        running: activeCount,
      },
      recentRuns,
      topFailures,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
