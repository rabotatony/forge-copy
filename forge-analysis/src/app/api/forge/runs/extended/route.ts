// Forge — start an extended run with full options
import type { NextRequest } from 'next/server';
import { startRunExtended, type RunOptions } from '@/lib/forge/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json() as RunOptions;
    if (!body.projectId || !body.workflow) {
      return Response.json({ error: 'projectId and workflow required' }, { status: 400 });
    }
    const result = await startRunExtended(body);
    return Response.json({ runId: result.runId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
