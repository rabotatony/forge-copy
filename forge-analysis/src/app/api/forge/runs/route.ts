// ============================================================
// Forge — start a run
// ============================================================
import type { NextRequest } from 'next/server';
import { startRun } from '@/lib/forge';

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
      return Response.json(
        { error: 'Missing projectId or workflow' },
        { status: 400 },
      );
    }

    const { runId } = await startRun({
      projectId: body.projectId,
      workflow: body.workflow,
      trigger: body.trigger ?? 'manual',
    });

    return Response.json({ runId, status: 'running' });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
