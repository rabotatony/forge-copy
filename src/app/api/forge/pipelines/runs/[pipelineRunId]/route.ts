// Forge — pipeline run detail
import type { NextRequest } from 'next/server';
import { getPipelineRun } from '@/lib/forge/pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ pipelineRunId: string }> }): Promise<Response> {
  try {
    const { pipelineRunId } = await params;
    const data = await getPipelineRun(pipelineRunId);
    if (!data) return Response.json({ error: 'Pipeline run not found' }, { status: 404 });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
