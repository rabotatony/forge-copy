// Forge — search logs in a single run
import type { NextRequest } from 'next/server';
import { searchLogs } from '@/lib/forge/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    if (!q) return Response.json({ error: 'q query param required' }, { status: 400 });
    const stream = url.searchParams.get('stream') as 'stdout' | 'stderr' | 'system' | undefined;
    const caseSensitive = url.searchParams.get('caseSensitive') === 'true';
    const useRegex = url.searchParams.get('useRegex') === 'true';
    const hits = await searchLogs(id, q, { stream, caseSensitive, useRegex });
    return Response.json({ hits, count: hits.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
