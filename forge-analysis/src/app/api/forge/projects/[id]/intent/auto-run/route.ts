// ============================================================
// Forge — auto-run the recommended workflow sequence
// ============================================================
// POST /api/forge/projects/[id]/intent/auto-run
//   → Starts the primary recommended workflow for the project.
//   → Returns { runId, workflow, intent }
//
// This is the "one-click" path: Forge detects what you want and
// runs the best workflow for it automatically.
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { detectIntent } from '@/lib/forge/intelligence';
import { recommend } from '@/lib/forge/router';
import { startRunExtended } from '@/lib/forge/engine';
import { getWorkflow } from '@/lib/forge/workflows';
import type { Detection, ProjectKind } from '@/lib/forge/detector';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: 'unknown', hints: [] } as Detection; }

    const kind = (project.kind as ProjectKind) ?? 'unknown';
    const intentResult = detectIntent(project.extractedPath, detection, kind);
    const recommendation = recommend(intentResult, kind, detection, project.extractedPath);

    if (!recommendation.primary) {
      return Response.json({ error: 'No suitable workflow found for this project' }, { status: 400 });
    }

    const wf = getWorkflow(recommendation.primary);
    if (!wf) {
      return Response.json({ error: `Workflow ${recommendation.primary} not found in catalog` }, { status: 400 });
    }

    const { runId } = await startRunExtended({
      projectId: id,
      workflow: recommendation.primary,
      trigger: 'auto',
      secrets: wf.secrets ?? [],
      env: {},
      retry: wf.defaultRetry,
      timeoutMs: wf.defaultTimeoutMs,
      requiresApproval: wf.requiresApproval ?? false,
      label: `Auto: ${intentResult.primary}`,
    });

    return Response.json({
      runId,
      workflow: recommendation.primary,
      intent: recommendation.intent,
      intentLabel: recommendation.intentLabel,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
