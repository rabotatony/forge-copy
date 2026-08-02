// ============================================================
// Forge — global run statistics (last 30 days)
// ============================================================
// Aggregates ALL runs across ALL projects started in the last 30
// days, grouped by UTC day. Used by the RunStatsChart on the home
// dashboard to visualize success/failure trends as a stacked bar
// chart.
//
// GET /api/forge/run-stats
// → {
//     days: [
//       { date: "2026-07-24", total: 7, success: 5, failed: 2, canceled: 0, running: 0 },
//       ...
//     ]
//   }
//
// The `days` array always contains exactly 30 entries (oldest
// first, today last) so the chart can render a stable X-axis even
// when there are gaps with zero runs.
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RunStatsDay {
  date: string;
  total: number;
  success: number;
  failed: number;
  canceled: number;
  running: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/** Format a Date as a stable YYYY-MM-DD string in UTC. */
function toDayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    // Compute the cutoff (start of the day WINDOW_DAYS ago, UTC).
    const now = new Date();
    const todayUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const cutoff = new Date(todayUtc - (WINDOW_DAYS - 1) * DAY_MS);

    // Fetch every run started within the window across ALL projects.
    // We only need startedAt + status, so select just those columns.
    const runs = await db.run.findMany({
      where: {
        startedAt: { gte: cutoff },
      },
      select: {
        startedAt: true,
        status: true,
      },
    });

    // Seed the 30-day window with zero entries so the response is
    // always 30 long even when days have no runs.
    const byDay = new Map<string, RunStatsDay>();
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const key = toDayKey(new Date(todayUtc - (WINDOW_DAYS - 1 - i) * DAY_MS));
      byDay.set(key, {
        date: key,
        total: 0,
        success: 0,
        failed: 0,
        canceled: 0,
        running: 0,
      });
    }

    // Bucket each run into its UTC day and tally by status.
    for (const r of runs) {
      const key = toDayKey(r.startedAt);
      const entry = byDay.get(key);
      // Defensive: runs older than the window are filtered by the
      // SQL `where`, but be robust to any time-zone edge case.
      if (!entry) continue;
      entry.total++;
      if (r.status === 'success') entry.success++;
      else if (r.status === 'failed') entry.failed++;
      else if (r.status === 'canceled') entry.canceled++;
      else if (r.status === 'running' || r.status === 'queued') {
        entry.running++;
      }
    }

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
