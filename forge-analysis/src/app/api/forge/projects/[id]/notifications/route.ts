// Forge — notifications list + create
import type { NextRequest } from 'next/server';
import { listNotifications, createNotification } from '@/lib/forge/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const notifications = await listNotifications(id);
    return Response.json({ notifications });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json() as { event: string; url: string };
    if (!body.event || !body.url) return Response.json({ error: 'event and url required' }, { status: 400 });
    const notification = await createNotification(id, body.event, body.url);
    return Response.json({ notification });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
