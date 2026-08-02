// ============================================================
// Forge — import a custom workflow from a portable JSON payload
// ============================================================
// Accepts the same shape produced by the /export route:
//   { workflow: { name, description?, steps, env? } }
// Validates the workflow shape minimally (non-empty name + each
// step has name+run), then runs it through the shared parser
// (`parseCustomWorkflow`) which performs full structural validation
// and returns a typed `CustomWorkflow`. The result is persisted as
// a brand-new custom workflow via `saveCustomWorkflow` (which stores
// it as a Pipeline row with a single 'custom' stage).
// ============================================================
import type { NextRequest } from 'next/server';
import { parseCustomWorkflow, saveCustomWorkflow } from '@/lib/forge/custom-workflow';
import type { CustomWorkflow } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ImportBody {
  workflow: {
    name?: unknown;
    description?: unknown;
    steps?: unknown;
    env?: unknown;
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }
    const root = body as ImportBody;
    if (!root.workflow || typeof root.workflow !== 'object') {
      return Response.json({ error: 'workflow object required' }, { status: 400 });
    }

    const wfIn = root.workflow;

    // name: non-empty string.
    if (typeof wfIn.name !== 'string' || wfIn.name.trim() === '') {
      return Response.json({ error: 'workflow.name must be a non-empty string' }, { status: 400 });
    }

    // steps: array of objects each with non-empty name + run.
    if (!Array.isArray(wfIn.steps) || wfIn.steps.length === 0) {
      return Response.json({ error: 'workflow.steps must be a non-empty array' }, { status: 400 });
    }
    for (let i = 0; i < wfIn.steps.length; i++) {
      const step = (wfIn.steps as unknown[])[i];
      if (typeof step !== 'object' || step === null) {
        return Response.json({ error: `Step ${i} must be an object` }, { status: 400 });
      }
      const s = step as Record<string, unknown>;
      if (typeof s.name !== 'string' || s.name.trim() === '') {
        return Response.json({ error: `Step ${i} must have a non-empty "name"` }, { status: 400 });
      }
      if (typeof s.run !== 'string' || s.run.trim() === '') {
        return Response.json({ error: `Step ${i} must have a non-empty "run" command` }, { status: 400 });
      }
    }

    // Run the shared parser for full structural validation + typing.
    // It accepts the same { name, description, steps, env, ... } shape
    // and throws with a descriptive message on any invalid field.
    let workflow: CustomWorkflow;
    try {
      workflow = parseCustomWorkflow(JSON.stringify(wfIn));
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Invalid workflow definition' },
        { status: 400 },
      );
    }

    const result = await saveCustomWorkflow(id, workflow.name, workflow);
    return Response.json({ id: result.id }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
