// ============================================================
// Forge — approval gate API
// ============================================================
// POST /api/forge/runs/[id]/approval — approve or reject a run
// GET  /api/forge/runs/[id]/approval — get approval status
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { approveRun, rejectRun } from '@/lib/forge/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const approval = await db.approval.findUnique({ where: { runId: id } });
    if (!approval) {
      return Response.json({ status: 'not_required' });
    }
    return Response.json({
      status: approval.status,
      decidedBy: approval.decidedBy,
      decidedAt: approval.decidedAt,
      reason: approval.reason,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await req.json() as { decision: 'approve' | 'reject'; decidedBy?: string; reason?: string };

    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return Response.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
    }

    if (body.decision === 'approve') {
      await approveRun(id, body.decidedBy ?? 'api', body.reason);
    } else {
      await rejectRun(id, body.decidedBy ?? 'api', body.reason);
    }

    return Response.json({ ok: true, decision: body.decision, runId: id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
