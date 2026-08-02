// ============================================================
// Forge — start a run
// ============================================================
import type { NextRequest } from 'next/server';
import { startRun } from '@/lib/forge';
import { fail, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json()) as {
      projectId?: string;
      workflow?: string;
      trigger?: 'manual' | 'auto';
    };
    if (!body.projectId || !body.workflow) {
      return fail('Missing projectId or workflow');
    }

    const { runId } = await startRun({
      projectId: body.projectId,
      workflow: body.workflow,
      trigger: body.trigger ?? 'manual',
    });

    await audit('run.started', 'run', runId, undefined, { projectId: body.projectId, workflow: body.workflow, trigger: body.trigger ?? 'manual' });
    return Response.json({ runId, status: 'running' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unknown workflow")) {
      return fail(msg, 400);
    }
    if (msg.includes("not found")) {
      return fail(msg, 404);
    }
    return serverError(err);
  }
}
