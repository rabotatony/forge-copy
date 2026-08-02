// Forge — prune cache
import type { NextRequest } from 'next/server';
import { pruneCache } from '@/lib/forge/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { maxEntries?: number };
    const removed = await pruneCache(id, body.maxEntries ?? 20);
    return Response.json({ removed });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
