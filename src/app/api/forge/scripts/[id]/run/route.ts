// Forge — run a saved script on a project
//
// Looks up the script's Pipeline row by id, pulls the embedded
// CustomWorkflow out of `config.customWorkflow`, and dispatches it via
// the custom workflow runner. Returns the new run id immediately;
// execution continues in the background and streams events over the
// shared SSE bus.
//
// Script↔pipeline encoding helpers come from `@/lib/forge/scripts` (R-4).
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { runCustomWorkflow } from '@/lib/forge/custom-workflow';
import { isScriptPipeline } from '@/lib/forge/scripts';
import { fail, notFound, serverError } from '@/lib/forge/response';
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
      return fail('projectId is required');
    }

    const pipeline = await db.pipeline.findUnique({ where: { id } });
    if (!pipeline) {
      return notFound('Script not found');
    }

    // Guard: the looked-up pipeline must actually be a script. The
    // `script:` prefix on the name is the canonical marker (see
    // `@/lib/forge/scripts`).
    if (!isScriptPipeline(pipeline)) {
      return fail('Pipeline is not a script (missing script: prefix)');
    }

    let config: { customWorkflow?: CustomWorkflow };
    try {
      config = JSON.parse(pipeline.config);
    } catch {
      return serverError(new Error('Invalid script config'));
    }
    if (!config.customWorkflow) {
      return serverError(new Error('Script pipeline is missing customWorkflow (corrupted row)'));
    }

    const result = await runCustomWorkflow(body.projectId, config.customWorkflow, {
      trigger: 'manual',
      label: pipeline.name,
    });
    return Response.json({ runId: result.runId });
  } catch (e) {
    return serverError(e);
  }
}
