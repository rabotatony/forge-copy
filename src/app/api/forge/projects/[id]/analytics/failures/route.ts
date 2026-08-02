// Forge — analytics: failure patterns
import type { NextRequest } from 'next/server';
import { failurePatterns } from '@/lib/forge/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const patterns = await failurePatterns(id, 20);
    return Response.json({ patterns });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
