// Forge — pipeline detail + delete
import type { NextRequest } from 'next/server';
import { getPipeline, deletePipeline } from '@/lib/forge/pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ pipelineId: string }> }): Promise<Response> {
  try {
    const { pipelineId } = await params;
    const pipeline = await getPipeline(pipelineId);
    if (!pipeline) return Response.json({ error: 'Pipeline not found' }, { status: 404 });
    return Response.json({ pipeline });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ pipelineId: string }> }): Promise<Response> {
  try {
    const { pipelineId } = await params;
    // We need the projectId to delete — getPipeline returns it.
    const pipeline = await getPipeline(pipelineId);
    if (!pipeline) return Response.json({ error: 'Pipeline not found' }, { status: 404 });
    await deletePipeline(pipeline.projectId, pipelineId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
