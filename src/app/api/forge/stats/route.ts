// ============================================================
// Forge — global system stats
// ============================================================
// Aggregated statistics across all projects + runs for the home
// page dashboard. Returns counts, success rate, workflow usage
// breakdown, and recent activity.
//
// GET /api/forge/stats
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const [projectCount, runCount, runs] = await Promise.all([
      db.project.count(),
      db.run.count(),
      db.run.findMany({
        orderBy: { startedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          workflow: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          exitCode: true,
          trigger: true,
          projectId: true,
        },
      }),
    ]);

    const total = runs.length;
    const successCount = runs.filter(r => r.status === 'success').length;
    const failedCount = runs.filter(r => r.status === 'failed').length;
    const canceledCount = runs.filter(r => r.status === 'canceled').length;
    const runningCount = runs.filter(r => r.status === 'running' || r.status === 'queued').length;
    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

    // Workflow usage breakdown (top 8 by count).
    const workflowCounts = new Map<string, number>();
    for (const r of runs) {
      workflowCounts.set(r.workflow, (workflowCounts.get(r.workflow) ?? 0) + 1);
    }
    const topWorkflows = Array.from(workflowCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([workflow, count]) => ({ workflow, count }));

    // Recent activity (last 10 runs with project name).
    const projectIds = Array.from(new Set(runs.map(r => r.projectId)));
    const projects = await db.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, kind: true },
    });
    const projectMap = new Map(projects.map(p => [p.id, p]));
    const recentActivity = runs.slice(0, 10).map(r => ({
      id: r.id,
      workflow: r.workflow,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      durationMs: r.durationMs,
      trigger: r.trigger,
      projectName: projectMap.get(r.projectId)?.name ?? 'unknown',
      projectKind: projectMap.get(r.projectId)?.kind ?? 'unknown',
    }));

    // Average duration (only for completed runs with duration).
    const completedRuns = runs.filter(r => r.durationMs !== null && r.durationMs > 0);
    const avgDurationMs = completedRuns.length > 0
      ? Math.round(completedRuns.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / completedRuns.length)
      : 0;

    return Response.json({
      projects: projectCount,
      totalRuns: runCount,
      recentRuns: total,
      successCount,
      failedCount,
      canceledCount,
      runningCount,
      successRate,
      avgDurationMs,
      topWorkflows,
      recentActivity,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
