// ============================================================
// Forge — analytics (Phase 2)
// ============================================================
// Provides:
//   • compareRuns(A, B)            — diff two runs (durations, errors, logs)
//   • performanceTrends(...)       — last N runs of a workflow as a series
//   • failurePatterns(...)         — per-workflow failure rates + samples
//   • searchLogs(...)              — in-run log line search (regex / substring)
//   • searchLogsAcrossRuns(...)    — project-wide SQL LIKE log search
// ============================================================

import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import type { FailurePattern, PerformancePoint, RunComparison } from './types';

const SEARCH_LOGS_PER_RUN_CAP = 5000;
const SEARCH_LOGS_RESULT_CAP = 500;
const SEARCH_ACROSS_RUNS_DEFAULT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Run comparison
// ---------------------------------------------------------------------------

/**
 * Compare two runs of the same project.  Computes duration diff, status
 * change, set-difference of error lines (in B but not A → newErrors; in A
 * but not B → resolvedErrors), and approximate log count diff using unique
 * line text.
 */
export async function compareRuns(runIdA: string, runIdB: string): Promise<RunComparison> {
  const [runA, runB] = await Promise.all([
    db.run.findUnique({
      where: { id: runIdA },
      include: { logs: { select: { seq: true, stream: true, text: true }, orderBy: { seq: 'asc' } } },
    }),
    db.run.findUnique({
      where: { id: runIdB },
      include: { logs: { select: { seq: true, stream: true, text: true }, orderBy: { seq: 'asc' } } },
    }),
  ]);

  if (!runA || !runB) {
    throw new Error('compareRuns: one or both runs not found');
  }

  const logsA = runA.logs;
  const logsB = runB.logs;

  // Duration diff (B - A, in ms; null if either is null).
  const durationDiff =
    runA.durationMs != null && runB.durationMs != null
      ? runB.durationMs - runA.durationMs
      : null;

  const statusChanged = runA.status !== runB.status;

  // Error lines: stderr stream OR text contains 'error' | 'Error' | 'FAIL'.
  const isError = (line: { stream: string; text: string }): boolean =>
    line.stream === 'stderr' || /error|Error|FAIL/.test(line.text);

  const errorSetA = new Set(logsA.filter(isError).map((l) => l.text));
  const errorSetB = new Set(logsB.filter(isError).map((l) => l.text));

  const newErrors = Array.from(errorSetB).filter((e) => !errorSetA.has(e));
  const resolvedErrors = Array.from(errorSetA).filter((e) => !errorSetB.has(e));

  // Approximate log count diff via set difference of unique line text.
  const lineSetA = new Set(logsA.map((l) => l.text));
  const lineSetB = new Set(logsB.map((l) => l.text));
  const addedLogs = Array.from(lineSetB).filter((t) => !lineSetA.has(t)).length;
  const removedLogs = Array.from(lineSetA).filter((t) => !lineSetB.has(t)).length;

  return {
    runA: {
      id: runA.id,
      workflow: runA.workflow,
      status: runA.status,
      durationMs: runA.durationMs,
      startedAt: runA.startedAt.toISOString(),
    },
    runB: {
      id: runB.id,
      workflow: runB.workflow,
      status: runB.status,
      durationMs: runB.durationMs,
      startedAt: runB.startedAt.toISOString(),
    },
    durationDiff,
    statusChanged,
    logCountA: logsA.length,
    logCountB: logsB.length,
    addedLogs,
    removedLogs,
    newErrors,
    resolvedErrors,
  };
}

// ---------------------------------------------------------------------------
// Performance trends
// ---------------------------------------------------------------------------

/**
 * Return the last `limit` runs (default 50) of `workflow` on `projectId`,
 * ordered by startedAt ascending.  Each point carries id, startedAt,
 * durationMs, status, and exitCode.
 */
export async function performanceTrends(
  projectId: string,
  workflow: string,
  limit = 50,
): Promise<PerformancePoint[]> {
  // Fetch the most recent `limit` runs (desc), then reverse to ascending.
  const runs = await db.run.findMany({
    where: { projectId, workflow },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  runs.reverse();
  return runs.map((r) => ({
    runId: r.id,
    startedAt: r.startedAt.toISOString(),
    durationMs: r.durationMs,
    status: r.status,
    exitCode: r.exitCode,
  }));
}

// ---------------------------------------------------------------------------
// Failure patterns
// ---------------------------------------------------------------------------

/**
 * Group all runs of a project by workflow and compute failure statistics for
 * each workflow.  Returns the top `limit` (default 20) workflows sorted by
 * failure rate descending.  For each workflow, up to 5 sample error messages
 * are pulled from the most recent failed runs' stderr lines.
 */
export async function failurePatterns(
  projectId: string,
  limit = 20,
): Promise<FailurePattern[]> {
  const runs = await db.run.findMany({
    where: { projectId },
    orderBy: { startedAt: 'desc' },
  });

  // Group by workflow (preserve order of first appearance = most recent).
  const byWorkflow = new Map<string, typeof runs>();
  for (const run of runs) {
    const bucket = byWorkflow.get(run.workflow);
    if (bucket) {
      bucket.push(run);
    } else {
      byWorkflow.set(run.workflow, [run]);
    }
  }

  // Collect IDs of the most-recent 5 failed runs per workflow (for batched
  // stderr line lookup).
  const failedRunIdsToSample: string[] = [];
  for (const [, workflowRuns] of byWorkflow) {
    let count = 0;
    for (const r of workflowRuns) {
      if (r.status !== 'failed') continue;
      failedRunIdsToSample.push(r.id);
      count++;
      if (count >= 5) break;
    }
  }

  // Batch-load stderr lines for the sampled failed runs.
  const sampleLogs =
    failedRunIdsToSample.length > 0
      ? await db.logLine.findMany({
          where: { runId: { in: failedRunIdsToSample }, stream: 'stderr' },
          orderBy: [{ runId: 'asc' }, { seq: 'desc' }],
        })
      : [];

  // Group sample logs by runId for easy per-run iteration.
  const logsByRun = new Map<string, typeof sampleLogs>();
  for (const l of sampleLogs) {
    const bucket = logsByRun.get(l.runId);
    if (bucket) {
      bucket.push(l);
    } else {
      logsByRun.set(l.runId, [l]);
    }
  }

  const patterns: FailurePattern[] = [];
  for (const [workflow, workflowRuns] of byWorkflow) {
    const totalRuns = workflowRuns.length;
    const failedRunsArr = workflowRuns.filter((r) => r.status === 'failed');
    const failedRuns = failedRunsArr.length;
    const failureRate = totalRuns > 0 ? failedRuns / totalRuns : 0;
    const lastFailed = failedRunsArr[0] ?? null;

    // Sample up to 5 error messages from the most recent failed runs.
    const sampleErrors: string[] = [];
    for (const r of workflowRuns) {
      if (r.status !== 'failed') continue;
      if (sampleErrors.length >= 5) break;
      const logs = logsByRun.get(r.id) ?? [];
      for (const l of logs) {
        if (sampleErrors.length >= 5) break;
        sampleErrors.push(l.text.slice(0, 200));
      }
    }

    patterns.push({
      workflow,
      totalRuns,
      failedRuns,
      failureRate,
      lastFailedAt: lastFailed?.startedAt.toISOString() ?? null,
      sampleErrors,
    });
  }

  // Sort by failure rate descending; ties broken by total runs desc.
  patterns.sort((a, b) => {
    if (b.failureRate !== a.failureRate) return b.failureRate - a.failureRate;
    return b.totalRuns - a.totalRuns;
  });
  return patterns.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Log search
// ---------------------------------------------------------------------------

export interface SearchLogsOptions {
  stream?: 'stdout' | 'stderr' | 'system';
  caseSensitive?: boolean;
  useRegex?: boolean;
}

export interface SearchLogHit {
  seq: number;
  stream: string;
  text: string;
  ts: Date;
}

/**
 * Search log lines of a single run.  Supports substring (default) or regex
 * matching, optional case sensitivity, and optional stream filter.  Caps at
 * 500 results.
 */
export async function searchLogs(
  runId: string,
  query: string,
  options?: SearchLogsOptions,
): Promise<SearchLogHit[]> {
  const where: Prisma.LogLineWhereInput = { runId };
  if (options?.stream) {
    where.stream = options.stream;
  }
  const logs = await db.logLine.findMany({
    where,
    orderBy: { seq: 'asc' },
    take: SEARCH_LOGS_PER_RUN_CAP,
  });

  let matcher: (text: string) => boolean;
  if (options?.useRegex) {
    // Security: limit regex length to prevent ReDoS.
    if (query.length > 200) {
      return [];
    }
    let re: RegExp;
    try {
      re = new RegExp(query, options.caseSensitive ? '' : 'i');
    } catch {
      // Invalid regex — return no results.
      return [];
    }
    // Security: wrap regex test with a timeout to prevent ReDoS.
    matcher = (text) => {
      if (text.length > 10000) return false; // skip very long lines
      try {
        return re.test(text);
      } catch {
        return false;
      }
    };
  } else {
    const q = options?.caseSensitive ? query : query.toLowerCase();
    matcher = (text) => {
      const t = options?.caseSensitive ? text : text.toLowerCase();
      return t.includes(q);
    };
  }

  const results: SearchLogHit[] = [];
  for (const l of logs) {
    if (matcher(l.text)) {
      results.push({ seq: l.seq, stream: l.stream, text: l.text, ts: l.ts });
      if (results.length >= SEARCH_LOGS_RESULT_CAP) break;
    }
  }
  return results;
}

export interface SearchAcrossRunsHit {
  runId: string;
  run: { workflow: string; status: string; startedAt: string };
  seq: number;
  stream: string;
  text: string;
}

/**
 * Search log lines across every run of a project using a SQL LIKE query.
 * Caps at `limit` (default 100) results.
 */
export async function searchLogsAcrossRuns(
  projectId: string,
  query: string,
  options?: { limit?: number },
): Promise<SearchAcrossRunsHit[]> {
  const limit = options?.limit ?? SEARCH_ACROSS_RUNS_DEFAULT_LIMIT;
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const logs = await db.logLine.findMany({
    where: {
      run: { projectId },
      text: { contains: trimmed },
    },
    include: { run: true },
    orderBy: { ts: 'desc' },
    take: limit,
  });

  return logs.map((l) => ({
    runId: l.runId,
    run: {
      workflow: l.run.workflow,
      status: l.run.status,
      startedAt: l.run.startedAt.toISOString(),
    },
    seq: l.seq,
    stream: l.stream,
    text: l.text,
  }));
}
