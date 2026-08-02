// Forge — cache list + delete
import type { NextRequest } from 'next/server';
import { listCache, deleteCache } from '@/lib/forge/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const entries = await listCache(id);
    return Response.json({ entries });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return Response.json({ error: 'key query param required' }, { status: 400 });
    await deleteCache(id, key);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
