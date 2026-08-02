// Forge — analytics: performance trends
import type { NextRequest } from 'next/server';
import { performanceTrends } from '@/lib/forge/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const workflow = url.searchParams.get('workflow') ?? '';
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 50;
    const trends = await performanceTrends(id, workflow, limit);
    return Response.json({ trends });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
