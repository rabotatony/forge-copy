// Forge — notification delete + toggle
import type { NextRequest } from 'next/server';
import { deleteNotification, toggleNotification } from '@/lib/forge/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; notificationId: string }> }): Promise<Response> {
  try {
    const { id, notificationId } = await params;
    await deleteNotification(id, notificationId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; notificationId: string }> }): Promise<Response> {
  try {
    const { id, notificationId } = await params;
    const body = await request.json() as { enabled: boolean };
    await toggleNotification(id, notificationId, body.enabled);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
