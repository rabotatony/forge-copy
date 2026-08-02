// Forge — delete a trigger
import type { NextRequest } from 'next/server';
import { deleteTrigger } from '@/lib/forge/triggers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; triggerId: string }> }): Promise<Response> {
  try {
    const { id, triggerId } = await params;
    await deleteTrigger(id, triggerId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
