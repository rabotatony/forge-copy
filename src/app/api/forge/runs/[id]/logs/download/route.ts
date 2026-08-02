// ============================================================
// Forge — download run logs as a text file
// ============================================================
// GET /api/forge/runs/[id]/logs/download
//   → text/plain (full log, formatted like CI output)
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;

    const run = await db.run.findUnique({
      where: { id },
      select: { id: true, workflow: true, status: true, startedAt: true, finishedAt: true, exitCode: true, durationMs: true },
    });
    if (!run) {
      return new Response('Run not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }

    const logs = await db.logLine.findMany({
      where: { runId: id },
      orderBy: { seq: 'asc' },
      select: { seq: true, stream: true, text: true, ts: true },
    });

    // Build a text log similar to CI output.
    const lines: string[] = [];
    lines.push(`# Forge Run Log`);
    lines.push(`# Workflow: ${run.workflow}`);
    lines.push(`# Status: ${run.status}`);
    lines.push(`# Started: ${run.startedAt.toISOString()}`);
    if (run.finishedAt) {
      lines.push(`# Finished: ${run.finishedAt.toISOString()}`);
    }
    lines.push(`# Exit code: ${run.exitCode ?? '—'}`);
    lines.push(`# Duration: ${run.durationMs ?? 0}ms`);
    lines.push(`# Log lines: ${logs.length}`);
    lines.push('');

    for (const log of logs) {
      const ts = log.ts.toISOString().slice(11, 23); // HH:MM:SS.mmm
      const prefix = log.stream === 'system' ? '▶' : log.stream === 'stderr' ? '⚠' : ' ';
      lines.push(`${ts} ${prefix} ${log.text}`);
    }

    lines.push('');
    lines.push(`# End of log`);

    const content = lines.join('\n');
    const filename = `forge-${run.workflow}-${id.slice(-8)}.log`;

    return new Response(content, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(
      `Error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500, headers: { 'content-type': 'text/plain' } },
    );
  }
}
