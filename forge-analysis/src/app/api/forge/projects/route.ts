// ============================================================
// Forge — list all projects
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const projects = await db.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    const data = projects.map((p) => {
      const lastRun = p.runs[0];
      return {
        id: p.id,
        name: p.name,
        fileName: p.fileName,
        kind: p.kind,
        fileSize: p.fileSize,
        fileCount: p.fileCount,
        createdAt: p.createdAt.toISOString(),
        runCount: 0, // filled below
        lastRunStatus: lastRun?.status ?? null,
      };
    });

    // Fetch run counts in one round-trip.
    const counts = await db.run.groupBy({
      by: ['projectId'],
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.projectId, c._count._all]));
    for (const d of data) d.runCount = countMap.get(d.id) ?? 0;

    return Response.json({ projects: data });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
