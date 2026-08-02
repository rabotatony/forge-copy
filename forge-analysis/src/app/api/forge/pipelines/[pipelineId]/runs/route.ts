// Forge — start a pipeline run
import type { NextRequest } from 'next/server';
import { executePipeline } from '@/lib/forge/pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ pipelineId: string }> }): Promise<Response> {
  try {
    const { pipelineId } = await params;
    const body = await request.json().catch(() => ({})) as { trigger?: string };
    const result = await executePipeline(pipelineId, body.trigger as 'manual' | 'auto' | 'webhook' | 'cron' | 'pipeline' | undefined);
    return Response.json({ pipelineRunId: result.pipelineRunId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
