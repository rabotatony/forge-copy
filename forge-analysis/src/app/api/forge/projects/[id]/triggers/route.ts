// Forge — triggers list + create
import type { NextRequest } from 'next/server';
import { createWebhookTrigger, createCronTrigger, listTriggers, validateCronExpression } from '@/lib/forge/triggers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const triggers = await listTriggers(id);
    return Response.json({ triggers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json() as {
      type: 'webhook' | 'cron';
      workflow: string;
      config: { slug?: string; expression?: string };
      pipelineId?: string;
      secret?: string;
    };
    if (!body.type || !body.workflow) {
      return Response.json({ error: 'type and workflow required' }, { status: 400 });
    }
    let trigger;
    if (body.type === 'webhook') {
      trigger = await createWebhookTrigger(id, body.workflow, { secret: body.secret, pipelineId: body.pipelineId });
    } else if (body.type === 'cron') {
      const expr = body.config?.expression;
      if (!expr) return Response.json({ error: 'config.expression required for cron' }, { status: 400 });
      if (!validateCronExpression(expr)) return Response.json({ error: 'invalid cron expression' }, { status: 400 });
      trigger = await createCronTrigger(id, body.workflow, expr, { pipelineId: body.pipelineId });
    } else {
      return Response.json({ error: 'type must be webhook or cron' }, { status: 400 });
    }
    return Response.json({ trigger });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
