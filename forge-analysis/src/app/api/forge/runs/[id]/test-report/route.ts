// Forge — test report for a run
import type { NextRequest } from 'next/server';
import { getTestReport } from '@/lib/forge/test-report';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const report = await getTestReport(id);
    if (!report) return Response.json({ found: false });
    return Response.json({ found: true, report });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
