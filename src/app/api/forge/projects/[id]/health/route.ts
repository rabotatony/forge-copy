// ============================================================
// Forge — project health score
// ============================================================
// Computes a composite 0–100 health score for a project from
// five weighted factors:
//   • Success Rate     (40%)  — % of runs with status=success
//   • Recent Activity  (20%)  — runs in last 7 days (max 10 = full)
//   • Average Duration (15%)  — sub-1s = full, 10s+ = 0 (linear)
//   • No Failures      (15%)  — 0 failures in last 10 runs = full
//   • Cache Usage      (10%)  — has any cache entries = full
//
// Returns:
//   { score, grade, factors: [{ name, score, weight, contribution }],
//     recommendation }
//
// GET /api/forge/projects/[id]/health
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

interface HealthFactor {
  name: string;
  score: number;        // 0-100 (this factor's individual score)
  weight: number;       // weight out of 100
  contribution: number; // round(score * weight / 100)
}

interface HealthResponse {
  score: number;
  grade: Grade;
  factors: HealthFactor[];
  recommendation: string;
}

const WEIGHTS = {
  successRate: 40,
  recentActivity: 20,
  avgDuration: 15,
  noFailures: 15,
  cacheUsage: 10,
} as const;

const FACTOR_NAMES = {
  successRate: 'Success Rate',
  recentActivity: 'Recent Activity',
  avgDuration: 'Average Duration',
  noFailures: 'No Failures',
  cacheUsage: 'Cache Usage',
} as const;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

function gradeFor(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function buildRecommendation(
  factors: HealthFactor[],
  hasAnyRun: boolean,
  cacheCount: number,
): string {
  if (!hasAnyRun) {
    return 'No runs yet. Trigger a pipeline run to start measuring project health.';
  }

  const success = factors.find((f) => f.name === FACTOR_NAMES.successRate);
  const activity = factors.find((f) => f.name === FACTOR_NAMES.recentActivity);
  const duration = factors.find((f) => f.name === FACTOR_NAMES.avgDuration);
  const failures = factors.find((f) => f.name === FACTOR_NAMES.noFailures);

  const issues: string[] = [];
  if (success && success.score < 60) {
    issues.push('Stabilize failing runs to improve the success rate.');
  }
  if (activity && activity.score < 50) {
    issues.push('Run pipelines more frequently to maintain recent activity.');
  }
  if (duration && duration.score < 50) {
    issues.push('Optimize build steps to reduce average run duration.');
  }
  if (failures && failures.score < 100) {
    issues.push('Investigate recent failures in the run logs.');
  }

  if (issues.length === 0) {
    return cacheCount === 0
      ? 'Project is healthy. Consider enabling caching for faster builds.'
      : 'Project is healthy. Keep up the good work.';
  }

  return cacheCount === 0
    ? `${issues.join(' ')} Also consider enabling caching for faster builds.`
    : issues.join(' ');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    // Pull a bounded set of recent runs (most recent first).
    const runs = await db.run.findMany({
      where: { projectId: id },
      orderBy: { startedAt: 'desc' },
      select: { status: true, startedAt: true, durationMs: true },
      take: 200,
    });

    const cacheCount = await db.cacheEntry.count({
      where: { projectId: id },
    });

    const totalRuns = runs.length;
    const hasAnyRun = totalRuns > 0;

    // --- Factor 1: Success Rate (40%) ---
    const successCount = runs.filter((r) => r.status === 'success').length;
    const successRateScore = totalRuns > 0
      ? clamp((successCount / totalRuns) * 100)
      : 0;

    // --- Factor 2: Recent Activity (20%) ---
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentRuns = runs.filter((r) => r.startedAt >= sevenDaysAgo).length;
    const recentActivityScore = clamp((recentRuns / 10) * 100);

    // --- Factor 3: Average Duration (15%) ---
    // sub-1s = full, 10s+ = 0, linear in between.
    const durations = runs
      .map((r) => r.durationMs)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    let avgDurationScore: number;
    if (durations.length === 0) {
      avgDurationScore = 0;
    } else {
      const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
      const avgSec = avgMs / 1000;
      if (avgSec <= 1) {
        avgDurationScore = 100;
      } else if (avgSec >= 10) {
        avgDurationScore = 0;
      } else {
        avgDurationScore = clamp(((10 - avgSec) / 9) * 100);
      }
    }

    // --- Factor 4: No Failures (15%) ---
    // 0 failures in last 10 runs = full; otherwise scaled by pass rate.
    const last10 = runs.slice(0, 10);
    const failuresInLast10 = last10.filter((r) => r.status === 'failed').length;
    const noFailuresScore = last10.length > 0
      ? clamp((1 - failuresInLast10 / last10.length) * 100)
      : 100;

    // --- Factor 5: Cache Usage (10%) ---
    const cacheScore = cacheCount > 0 ? 100 : 0;

    const factors: HealthFactor[] = [
      {
        name: FACTOR_NAMES.successRate,
        score: successRateScore,
        weight: WEIGHTS.successRate,
        contribution: clamp((successRateScore * WEIGHTS.successRate) / 100),
      },
      {
        name: FACTOR_NAMES.recentActivity,
        score: recentActivityScore,
        weight: WEIGHTS.recentActivity,
        contribution: clamp((recentActivityScore * WEIGHTS.recentActivity) / 100),
      },
      {
        name: FACTOR_NAMES.avgDuration,
        score: avgDurationScore,
        weight: WEIGHTS.avgDuration,
        contribution: clamp((avgDurationScore * WEIGHTS.avgDuration) / 100),
      },
      {
        name: FACTOR_NAMES.noFailures,
        score: noFailuresScore,
        weight: WEIGHTS.noFailures,
        contribution: clamp((noFailuresScore * WEIGHTS.noFailures) / 100),
      },
      {
        name: FACTOR_NAMES.cacheUsage,
        score: cacheScore,
        weight: WEIGHTS.cacheUsage,
        contribution: clamp((cacheScore * WEIGHTS.cacheUsage) / 100),
      },
    ];

    const score = clamp(factors.reduce((sum, f) => sum + f.contribution, 0));
    const grade = gradeFor(score);
    const recommendation = buildRecommendation(factors, hasAnyRun, cacheCount);

    const body: HealthResponse = { score, grade, factors, recommendation };
    return Response.json(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
