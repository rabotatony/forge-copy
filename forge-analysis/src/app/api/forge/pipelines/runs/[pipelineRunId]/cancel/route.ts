// Forge — cancel a pipeline run
import type { NextRequest } from 'next/server';
import { cancelPipelineRun } from '@/lib/forge/pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ pipelineRunId: string }> }): Promise<Response> {
  try {
    const { pipelineRunId } = await params;
    await cancelPipelineRun(pipelineRunId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
