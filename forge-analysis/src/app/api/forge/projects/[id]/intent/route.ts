// ============================================================
// Forge — intelligent intent detection endpoint
// ============================================================
// Returns what Forge thinks the user wants to produce from this
// project, plus recommended workflows and an auto-run sequence.
//
// GET /api/forge/projects/[id]/intent
//   → { intent, intentLabel, summary, signals, primary, recommended,
//       autoRun, available, primaryAvailable, reasons }
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { detectIntent } from '@/lib/forge/intelligence';
import { recommend } from '@/lib/forge/router';
import type { Detection, ProjectKind } from '@/lib/forge/detector';
import { INTENT_LABELS } from '@/lib/forge/intelligence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: 'unknown', hints: [] } as Detection; }

    const kind = (project.kind as ProjectKind) ?? 'unknown';
    const projectRoot = project.extractedPath;

    // Run intent detection.
    const intentResult = detectIntent(projectRoot, detection, kind);

    // Run the smart router for workflow recommendations.
    const recommendation = recommend(intentResult, kind, detection, projectRoot);

    return Response.json({
      intent: recommendation.intent,
      intentLabel: INTENT_LABELS[recommendation.intent]?.label ?? recommendation.intent,
      intentEmoji: INTENT_LABELS[recommendation.intent]?.emoji ?? '',
      intentDescription: INTENT_LABELS[recommendation.intent]?.description ?? '',
      summary: recommendation.summary,
      signals: recommendation.signals,
      primary: recommendation.primary,
      recommended: recommendation.recommended,
      autoRun: recommendation.autoRun,
      available: recommendation.available,
      primaryAvailable: recommendation.primaryAvailable,
      reasons: recommendation.reasons,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
