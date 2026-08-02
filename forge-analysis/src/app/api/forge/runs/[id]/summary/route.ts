// ============================================================
// Forge — run summary (markdown, like $GITHUB_STEP_SUMMARY)
// ============================================================
// GET  /api/forge/runs/[id]/summary  — get summary
// PUT  /api/forge/runs/[id]/summary  — create/update summary
//   body: { content: string }  (markdown)
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const summary = await db.runSummary.findUnique({ where: { runId: id } });
    return Response.json({ summary: summary?.content ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await req.json() as { content?: string };
    if (typeof body.content !== 'string') {
      return Response.json({ error: 'content (string) is required' }, { status: 400 });
    }
    // Limit to 64KB to prevent abuse.
    const content = body.content.slice(0, 65536);
    const summary = await db.runSummary.upsert({
      where: { runId: id },
      create: { runId: id, content },
      update: { content },
    });
    return Response.json({ summary: summary.content });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
