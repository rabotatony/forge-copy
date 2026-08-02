// Forge — custom workflows list + create
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { saveCustomWorkflow } from '@/lib/forge/custom-workflow';
import type { CustomWorkflow } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const pipelines = await db.pipeline.findMany({ where: { projectId: id } });
    const customWorkflows = pipelines
      .filter(p => {
        try {
          const config = JSON.parse(p.config);
          return config?.customWorkflow !== undefined;
        } catch { return false; }
      })
      .map(p => {
        let workflow: CustomWorkflow | null = null;
        try { workflow = JSON.parse(p.config).customWorkflow; } catch { /* ignore */ }
        return {
          id: p.id,
          name: p.name,
          workflow,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
      });
    return Response.json({ customWorkflows });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json() as { name: string; workflow: CustomWorkflow };
    if (!body.name || !body.workflow) return Response.json({ error: 'name and workflow required' }, { status: 400 });
    const result = await saveCustomWorkflow(id, body.name, body.workflow);
    return Response.json({ id: result.id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
