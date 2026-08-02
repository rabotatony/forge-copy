// Forge — analytics: compare two runs
import type { NextRequest } from 'next/server';
import { compareRuns } from '@/lib/forge/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    void id;
    const url = new URL(request.url);
    const runA = url.searchParams.get('runA');
    const runB = url.searchParams.get('runB');
    if (!runA || !runB) return Response.json({ error: 'runA and runB query params required' }, { status: 400 });
    const comparison = await compareRuns(runA, runB);
    return Response.json({ comparison });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
