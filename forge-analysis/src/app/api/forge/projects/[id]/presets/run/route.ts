// ============================================================
// Forge — run a workflow preset (curated multi-workflow sequence)
// ============================================================
// POST /api/forge/projects/[id]/presets/run
//   body: { presetId: string }
//   → Creates a pipeline + starts executing it immediately.
//   → Returns { pipelineId, pipelineRunId, presetId, steps }
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { WORKFLOW_PRESETS } from '@/lib/forge/presets';
import { executePipeline } from '@/lib/forge/pipeline';
import type { Detection, ProjectKind } from '@/lib/forge/detector';
import { workflowsForKind } from '@/lib/forge/workflows';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await req.json() as { presetId?: string };
    if (!body.presetId) {
      return Response.json({ error: 'presetId is required' }, { status: 400 });
    }

    const preset = WORKFLOW_PRESETS.find(p => p.id === body.presetId);
    if (!preset) {
      return Response.json({ error: `Unknown preset: ${body.presetId}` }, { status: 404 });
    }

    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    // Verify all preset steps are available for this project.
    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: 'unknown', hints: [] } as Detection; }
    const kind = (project.kind as ProjectKind) ?? 'unknown';
    const available = new Set(workflowsForKind(kind, detection, project.extractedPath).map(w => w.key));
    const missing = preset.steps.filter(s => !available.has(s));
    if (missing.length > 0) {
      return Response.json({
        error: `Preset "${preset.name}" requires workflows not available for this project: ${missing.join(', ')}`,
        missing,
      }, { status: 400 });
    }

    // Create a pipeline that represents this preset.
    const pipeline = await db.pipeline.create({
      data: {
        projectId: id,
        name: `${preset.emoji} ${preset.name}`,
        stages: JSON.stringify(preset.steps.map((workflow, idx) => ({
          id: `stage-${idx}`,
          name: workflow,
          workflow,
          dependsOn: idx > 0 ? [`stage-${idx - 1}`] : [],
        }))),
        config: JSON.stringify({
          concurrentCancellation: true,
          defaultRetry: 0,
          defaultTimeoutMs: preset.estimatedSeconds * 1000,
          notifications: [],
        }),
      },
    });

    // Actually execute the pipeline (creates a pipeline run + runs stages).
    const { pipelineRunId } = await executePipeline(pipeline.id, 'manual');

    return Response.json({
      pipelineId: pipeline.id,
      pipelineRunId,
      presetId: preset.id,
      presetName: preset.name,
      steps: preset.steps,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
