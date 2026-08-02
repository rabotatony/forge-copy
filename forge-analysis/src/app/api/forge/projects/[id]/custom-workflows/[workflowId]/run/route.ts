// Forge — run a saved custom workflow
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { runCustomWorkflow } from '@/lib/forge/custom-workflow';
import type { CustomWorkflow } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; workflowId: string }> }): Promise<Response> {
  try {
    const { id, workflowId } = await params;
    const body = await request.json().catch(() => ({})) as { trigger?: string; matrixValues?: Record<string, string> };

    // Load the custom workflow from the pipeline.
    const pipeline = await db.pipeline.findUnique({ where: { id: workflowId } });
    if (!pipeline || pipeline.projectId !== id) {
      return Response.json({ error: 'Custom workflow not found' }, { status: 404 });
    }
    let config: { customWorkflow?: CustomWorkflow };
    try {
      config = JSON.parse(pipeline.config);
    } catch {
      return Response.json({ error: 'Invalid custom workflow config' }, { status: 500 });
    }
    if (!config.customWorkflow) {
      return Response.json({ error: 'Pipeline is not a custom workflow' }, { status: 400 });
    }

    const result = await runCustomWorkflow(id, config.customWorkflow, {
      trigger: body.trigger as 'manual' | 'auto' | 'webhook' | 'cron' | 'pipeline' | undefined,
      matrixValues: body.matrixValues,
      label: pipeline.name,
    });
    return Response.json({ runId: result.runId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
