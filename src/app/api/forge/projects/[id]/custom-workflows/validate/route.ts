// Forge — validate a custom workflow definition
import type { NextRequest } from 'next/server';
import { validateCustomWorkflow } from '@/lib/forge/custom-workflow';
import type { CustomWorkflow } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    void id;
    const body = await request.json() as { workflow: CustomWorkflow };
    if (!body.workflow) return Response.json({ error: 'workflow required' }, { status: 400 });
    const result = validateCustomWorkflow(body.workflow);
    return Response.json({ valid: result.valid, errors: result.errors });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
