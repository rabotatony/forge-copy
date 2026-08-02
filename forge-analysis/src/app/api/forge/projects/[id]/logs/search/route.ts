// Forge — search logs across all runs of a project
import type { NextRequest } from 'next/server';
import { searchLogsAcrossRuns } from '@/lib/forge/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    if (!q) return Response.json({ error: 'q query param required' }, { status: 400 });
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 100;
    const hits = await searchLogsAcrossRuns(id, q, { limit });
    return Response.json({ hits, count: hits.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
