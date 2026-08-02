// ============================================================
// Forge — AI-powered project insights report
// ============================================================
// Gathers project metadata + recent runs + workflow stats and
// asks the z-ai-web-dev-sdk LLM to produce a concise (<200 word)
// natural-language insights report.
//
// GET /api/forge/projects/[id]/insights
//   → { report: string, generatedAt: string }
//
// If the LLM call fails (network error, parse error, empty
// response), a deterministic rule-based report is returned so the
// UI always has something useful to show.
// ============================================================
import type { NextRequest } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SYSTEM_PROMPT =
  'You are a CI/CD analyst. Analyze the following project data and provide a concise insights report with: 1) Overall health assessment, 2) Key observations, 3) Recommendations. Keep it under 200 words.';

interface RecentRunSummary {
  workflow: string;
  status: string;
  durationMs: number | null;
  startedAt: string;
}

interface ProjectContext {
  project: {
    name: string;
    kind: string;
    fileName: string;
    fileSize: number;
    fileCount: number;
    createdAt: string;
  };
  recentRuns: RecentRunSummary[];
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  workflowCounts: Array<{ workflow: string; count: number; successRate: number }>;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  if (ms < 1_000) return `${ms}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function buildContextString(ctx: ProjectContext): string {
  const lines: string[] = [];
  lines.push(`Project: ${ctx.project.name}`);
  lines.push(`Kind: ${ctx.project.kind}`);
  lines.push(`Source file: ${ctx.project.fileName} (${formatBytes(ctx.project.fileSize)})`);
  lines.push(`File count: ${ctx.project.fileCount}`);
  lines.push(`Created: ${ctx.project.createdAt}`);
  lines.push(`Total runs (last 200): ${ctx.totalRuns}`);
  lines.push(`Success rate: ${(ctx.successRate * 100).toFixed(1)}%`);
  lines.push(`Average duration: ${formatDuration(ctx.avgDurationMs)}`);
  lines.push('');
  lines.push('Workflow breakdown:');
  for (const w of ctx.workflowCounts) {
    lines.push(
      `  - ${w.workflow}: ${w.count} runs, ${(w.successRate * 100).toFixed(0)}% success`,
    );
  }
  lines.push('');
  lines.push('Recent runs (last 10):');
  for (const r of ctx.recentRuns) {
    lines.push(
      `  - ${r.startedAt} | ${r.workflow} | ${r.status} | ${formatDuration(r.durationMs ?? 0)}`,
    );
  }
  return lines.join('\n');
}

function buildFallbackReport(ctx: ProjectContext): string {
  const pct = (ctx.successRate * 100).toFixed(0);
  const avg = formatDuration(ctx.avgDurationMs);
  const lines: string[] = [];

  // 1) Overall health assessment.
  let health: string;
  if (ctx.successRate >= 0.9) health = 'healthy';
  else if (ctx.successRate >= 0.7) health = 'moderately healthy';
  else if (ctx.successRate >= 0.5) health = 'at risk';
  else health = 'critical';
  lines.push(
    `Overall health: ${health}. Project "${ctx.project.name}" (${ctx.project.kind}) has ${ctx.totalRuns} total runs with a ${pct}% success rate and an average duration of ${avg}.`,
  );

  // 2) Key observations.
  const obs: string[] = [];
  obs.push(`${ctx.project.fileCount} files (${formatBytes(ctx.project.fileSize)})`);
  if (ctx.workflowCounts.length > 0) {
    const top = ctx.workflowCounts[0];
    obs.push(
      `most-used workflow is "${top.workflow}" (${top.count} runs, ${(top.successRate * 100).toFixed(0)}% success)`,
    );
  }
  if (ctx.successRate < 0.7 && ctx.totalRuns > 0) {
    obs.push('failure rate is elevated — investigate recent failures');
  }
  if (ctx.avgDurationMs > 0 && ctx.avgDurationMs > 5 * 60 * 1000) {
    obs.push('average run duration exceeds 5 minutes — consider caching');
  }
  lines.push(`Key observations: ${obs.join('; ')}.`);

  // 3) Recommendations.
  let rec: string;
  if (ctx.totalRuns === 0) {
    rec = 'Run your first workflow to start collecting CI data.';
  } else if (ctx.successRate < 0.7) {
    rec = 'Review failing runs and fix the most common error before adding new workflows.';
  } else if (ctx.avgDurationMs > 5 * 60 * 1000) {
    rec = 'Enable caching and parallelize independent stages to cut run time.';
  } else if (ctx.successRate >= 0.9) {
    rec = 'Health is strong — keep monitoring and consider adding deployment automation.';
  } else {
    rec = 'Address the occasional failures and add tests to catch regressions early.';
  }
  lines.push(`Recommendation: ${rec}`);

  return lines.join('\n');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 200,
        },
      },
    });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const allRuns = project.runs;
    const total = allRuns.length;
    const successCount = allRuns.filter((r) => r.status === 'success').length;
    const durations = allRuns
      .filter((r) => r.durationMs !== null)
      .map((r) => r.durationMs as number);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    const successRate = total > 0 ? successCount / total : 0;

    // Workflow counts.
    const byWorkflow = new Map<string, { count: number; success: number }>();
    for (const r of allRuns) {
      const entry = byWorkflow.get(r.workflow) ?? { count: 0, success: 0 };
      entry.count++;
      if (r.status === 'success') entry.success++;
      byWorkflow.set(r.workflow, entry);
    }
    const workflowCounts = Array.from(byWorkflow.entries())
      .map(([workflow, v]) => ({
        workflow,
        count: v.count,
        successRate: v.count > 0 ? v.success / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const recentRuns: RecentRunSummary[] = allRuns.slice(0, 10).map((r) => ({
      workflow: r.workflow,
      status: r.status,
      durationMs: r.durationMs,
      startedAt: r.startedAt.toISOString(),
    }));

    const ctx: ProjectContext = {
      project: {
        name: project.name,
        kind: project.kind,
        fileName: project.fileName,
        fileSize: project.fileSize,
        fileCount: project.fileCount,
        createdAt: project.createdAt.toISOString(),
      },
      recentRuns,
      totalRuns: total,
      successRate,
      avgDurationMs,
      workflowCounts,
    };

    const contextString = buildContextString(ctx);

    // Try the LLM. On any failure, fall back to the rule-based report.
    let report = '';
    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: contextString },
        ],
        thinking: { type: 'disabled' },
      });
      report = (completion.choices[0]?.message?.content ?? '').trim();
      if (!report) {
        report = buildFallbackReport(ctx);
      }
    } catch {
      report = buildFallbackReport(ctx);
    }

    return Response.json({
      report,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
