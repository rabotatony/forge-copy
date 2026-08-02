// Forge — webhook deliveries for a trigger
import type { NextRequest } from 'next/server';
import { listWebhookDeliveries } from '@/lib/forge/triggers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; triggerId: string }> }): Promise<Response> {
  try {
    const { triggerId } = await params;
    const deliveries = await listWebhookDeliveries(triggerId);
    return Response.json({ deliveries });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
