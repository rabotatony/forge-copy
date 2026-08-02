// ============================================================
// Forge — project activity heatmap
// ============================================================
// Returns run activity for the last 90 days, grouped by day.
//
// GET /api/forge/projects/[id]/activity
// → { days: [{ date: "2026-07-23", count: 5, success: 4, failed: 1 }] }
//
// Days with no runs are omitted from the response (the client
// fills the gaps with zero-count cells when rendering the grid).
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ActivityDay {
  date: string;
  count: number;
  success: number;
  failed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;

/** Format a Date as a stable YYYY-MM-DD string in UTC. */
function toDayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    // Compute the cutoff (start of the day WINDOW_DAYS ago, UTC).
    const now = new Date();
    const todayUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const cutoff = new Date(todayUtc - (WINDOW_DAYS - 1) * DAY_MS);

    // Fetch every run started within the window. We only need
    // startedAt + status, so select just those columns.
    const runs = await db.run.findMany({
      where: {
        projectId: id,
        startedAt: { gte: cutoff },
      },
      select: {
        startedAt: true,
        status: true,
      },
    });

    // Group by UTC day.
    const byDay = new Map<string, ActivityDay>();
    for (const r of runs) {
      const key = toDayKey(r.startedAt);
      const entry =
        byDay.get(key) ?? { date: key, count: 0, success: 0, failed: 0 };
      entry.count++;
      if (r.status === 'success') entry.success++;
      if (r.status === 'failed') entry.failed++;
      byDay.set(key, entry);
    }

    // Return days sorted ascending by date.
    const days = Array.from(byDay.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );

    return Response.json({ days });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
