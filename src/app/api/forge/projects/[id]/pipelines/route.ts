// Forge — pipelines list + create
import type { NextRequest } from 'next/server';
import { createPipeline, listPipelines, validatePipelineDefinition } from '@/lib/forge/pipeline';
import type { PipelineDefinition } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const pipelines = await listPipelines(id);
    return Response.json({ pipelines });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json() as { name: string; definition: PipelineDefinition };
    if (!body.name || !body.definition) return Response.json({ error: 'name and definition required' }, { status: 400 });
    const validation = validatePipelineDefinition(body.definition);
    if (!validation.valid) return Response.json({ error: 'Invalid pipeline', errors: validation.errors }, { status: 400 });
    const result = await createPipeline(id, body.name, body.definition);
    return Response.json({ id: result.id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
