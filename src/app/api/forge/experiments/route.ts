// ============================================================
// Forge — Experiments Lab: list experiments + runs
// GET /api/forge/experiments           → list all experiments + latest run
// GET /api/forge/experiments?slug=xxx  → list recent runs for an experiment
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { EXPERIMENTS, listExperimentsWithLatestRun, listRuns } from '@/lib/forge/experiments/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug');
  if (slug) {
    const runs = await listRuns(slug, 30);
    return Response.json({ slug, runs });
  }
  const experiments = await listExperimentsWithLatestRun();
  // Also surface the static definitions for any not yet in DB.
  const stats = {
    totalExperiments: EXPERIMENTS.length,
    byCategory: EXPERIMENTS.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {}),
  };
  // Global stats across all runs.
  const allRuns = await db.experimentRun.groupBy({
    by: ['verdict'],
    _count: true,
  });
  const verdictCounts: Record<string, number> = { BREAKTHROUGH: 0, NO_CHANGE: 0, REGRESSION: 0 };
  for (const g of allRuns) {
    if (g.verdict) verdictCounts[g.verdict] = g._count;
  }
  const promotedCount = await db.experimentRun.count({ where: { promoted: true } });
  return Response.json({ experiments, stats, verdictCounts, promotedCount });
}
