// ============================================================
// Forge — Experiments Lab: get a run + promote a breakthrough
// GET    /api/forge/experiments/runs/[runId]           → run detail + evidence
// POST   /api/forge/experiments/runs/[runId]/promote   → promote to permanent workflow
// DELETE /api/forge/experiments/runs/[runId]           → delete a run
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { promoteExperimentRun } from '@/lib/forge/experiments/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await db.experimentRun.findUnique({
    where: { id: runId },
    include: { experiment: true },
  });
  if (!run) return Response.json({ error: 'Run not found' }, { status: 404 });
  let evidenceParsed: unknown = null;
  let metricsParsed: unknown = null;
  try { evidenceParsed = run.evidence ? JSON.parse(run.evidence) : null; } catch { /* ignore */ }
  try { metricsParsed = run.metrics ? JSON.parse(run.metrics) : null; } catch { /* ignore */ }
  return Response.json({
    run: {
      id: run.id,
      status: run.status,
      verdict: run.verdict,
      verdictReason: run.verdictReason,
      promoted: run.promoted,
      promotedWorkflowId: run.promotedWorkflowId,
      promotedPresetId: run.promotedPresetId,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      metrics: metricsParsed,
      evidence: evidenceParsed,
    },
    experiment: {
      slug: run.experiment.slug,
      name: run.experiment.name,
      category: run.experiment.category,
      hypothesis: run.experiment.hypothesis,
      procedure: run.experiment.procedure,
      dangerLevel: run.experiment.dangerLevel,
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const url = new URL(request.url);
  if (url.searchParams.get('action') === 'promote') {
    try {
      const result = await promoteExperimentRun(runId);
      return Response.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 400 });
    }
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    await db.experimentRun.delete({ where: { id: runId } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Run not found' }, { status: 404 });
  }
}
