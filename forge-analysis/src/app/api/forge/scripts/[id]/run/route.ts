// Forge — run a saved script on a project
//
// Looks up the script's Pipeline row by id, pulls the embedded
// CustomWorkflow out of `config.customWorkflow`, and dispatches it via
// the custom workflow runner. Returns the new run id immediately;
// execution continues in the background and streams events over the
// shared SSE bus.
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { runCustomWorkflow } from '@/lib/forge/custom-workflow';
import type { CustomWorkflow } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RunScriptBody {
  projectId: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Partial<RunScriptBody>;
    if (typeof body.projectId !== 'string' || body.projectId.trim() === '') {
      return Response.json({ error: 'projectId is required' }, { status: 400 });
    }

    const pipeline = await db.pipeline.findUnique({ where: { id } });
    if (!pipeline) {
      return Response.json({ error: 'Script not found' }, { status: 404 });
    }

    let config: { customWorkflow?: CustomWorkflow };
    try {
      config = JSON.parse(pipeline.config);
    } catch {
      return Response.json({ error: 'Invalid script config' }, { status: 500 });
    }
    if (!config.customWorkflow) {
      return Response.json(
        { error: 'Pipeline is not a script (missing customWorkflow)' },
        { status: 400 },
      );
    }

    const result = await runCustomWorkflow(body.projectId, config.customWorkflow, {
      trigger: 'manual',
      label: pipeline.name,
    });
    return Response.json({ runId: result.runId });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
