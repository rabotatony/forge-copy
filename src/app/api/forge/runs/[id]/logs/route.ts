// ============================================================
// Forge — list log lines for a run
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LINES = 5000;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const run = await db.run.findUnique({ where: { id }, select: { id: true } });
    if (!run) {
      return Response.json({ error: 'Run not found' }, { status: 404 });
    }

    const total = await db.logLine.count({ where: { runId: id } });
    const truncated = total > MAX_LINES;

    let logs;
    if (truncated) {
      // Skip the older lines and return the most recent MAX_LINES.
      const skip = total - MAX_LINES;
      logs = await db.logLine.findMany({
        where: { runId: id },
        orderBy: { seq: 'asc' },
        skip,
        take: MAX_LINES,
      });
    } else {
      logs = await db.logLine.findMany({
        where: { runId: id },
        orderBy: { seq: 'asc' },
      });
    }

    return Response.json({
      logs: logs.map((l) => ({
        seq: l.seq,
        stream: l.stream,
        text: l.text,
        ts: l.ts.toISOString(),
      })),
      truncated,
      total,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
