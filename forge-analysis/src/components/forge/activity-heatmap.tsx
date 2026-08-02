"use client";

// ============================================================
// ActivityHeatmap — GitHub-style contribution calendar that
// visualizes run activity for a Forge project over the last
// 90 days. Color intensity is emerald (never indigo/blue).
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { Calendar, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ActivityDay {
  date: string;
  count: number;
  success: number;
  failed: number;
}

interface ActivityResponse {
  days: ActivityDay[];
}

interface ActivityHeatmapProps {
  projectId: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 13; // ~13 columns covers ~91 days ≈ 90 days
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Format a Date as YYYY-MM-DD in UTC (matches the API grouping). */
function toDayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Map a run count to its cell background class. */
function getCellClass(count: number): string {
  if (count === 0) return "bg-muted";
  if (count <= 2) return "bg-emerald-500/30";
  if (count <= 5) return "bg-emerald-500/50";
  return "bg-emerald-500/80";
}

interface Cell {
  date: string;
  count: number;
  success: number;
  failed: number;
  future: boolean;
}

export function ActivityHeatmap({ projectId }: ActivityHeatmapProps) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "projects", projectId, "activity"],
    queryFn: async () => {
      const r = await fetch(
        `/api/forge/projects/${projectId}/activity`,
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Activity fetch failed (${r.status})`,
        );
      }
      return (await r.json()) as ActivityResponse;
    },
    staleTime: 60_000,
    retry: false,
  });

  // Compute the grid (WEEKS weeks × 7 days), ending at the end of
  // the current UTC week. Use UTC day keys so they match the API.
  const now = new Date();
  const todayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const todayDow = new Date(todayUtcMs).getUTCDay(); // 0=Sun..6=Sat
  const currentWeekStartMs = todayUtcMs - todayDow * DAY_MS;
  const gridStartMs =
    currentWeekStartMs - (WEEKS - 1) * 7 * DAY_MS;

  // Index activity days by date key for O(1) lookup.
  const byDate = new Map<string, ActivityDay>();
  if (data) {
    for (const d of data.days) byDate.set(d.date, d);
  }

  // Build columns (weeks). Each column has 7 cells (Sun..Sat).
  const columns: Cell[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const col: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const cellMs = gridStartMs + (w * 7 + d) * DAY_MS;
      const dateKey = toDayKey(new Date(cellMs));
      const entry = byDate.get(dateKey);
      col.push({
        date: dateKey,
        count: entry?.count ?? 0,
        success: entry?.success ?? 0,
        failed: entry?.failed ?? 0,
        future: cellMs > todayUtcMs,
      });
    }
    columns.push(col);
  }

  const totalRuns = data
    ? data.days.reduce((sum, d) => sum + d.count, 0)
    : 0;
  const activeDays = data ? data.days.length : 0;

  const cellTitle = (c: Cell): string => {
    if (c.future) return `${c.date} (upcoming)`;
    if (c.count === 0) return `No runs on ${c.date}`;
    return `${c.count} run${c.count === 1 ? "" : "s"} on ${c.date}`;
  };

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="size-4 text-emerald-600" />
          Activity
        </CardTitle>
        <CardDescription>
          Run activity over the last 90 days.
          {data ? (
            <span className="ml-1 text-muted-foreground/80">
              {" · "}
              {totalRuns} run{totalRuns === 1 ? "" : "s"} across{" "}
              {activeDays} day{activeDays === 1 ? "" : "s"}.
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-emerald-600" />
            Loading activity…
          </div>
        ) : isError ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error instanceof Error
              ? error.message
              : "Failed to load activity"}
          </div>
        ) : (
          <>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {/* Day-of-week labels column — only every other label is shown
                  to keep the column visually compact (à la GitHub). */}
              <div className="flex shrink-0 flex-col gap-1 text-[10px] font-medium text-muted-foreground">
                {DOW_LABELS.map((label, i) => (
                  <div
                    key={label}
                    className="flex h-3.5 items-center justify-end pr-1"
                    style={{
                      visibility: i % 2 === 0 ? "visible" : "hidden",
                    }}
                  >
                    {label}
                  </div>
                ))}
              </div>
              {/* Weeks grid */}
              <div className="flex gap-1">
                {columns.map((col, wi) => (
                  <div key={wi} className="flex flex-col gap-1">
                    {col.map((cell, di) => (
                      <div
                        key={`${wi}-${di}`}
                        title={cellTitle(cell)}
                        className={cn(
                          "h-3.5 w-3.5 rounded-sm transition-colors",
                          cell.future
                            ? "bg-transparent"
                            : getCellClass(cell.count),
                        )}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {/* Legend */}
            <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
              <span>Less</span>
              <div className="h-3 w-3 rounded-sm bg-muted" />
              <div className="h-3 w-3 rounded-sm bg-emerald-500/30" />
              <div className="h-3 w-3 rounded-sm bg-emerald-500/50" />
              <div className="h-3 w-3 rounded-sm bg-emerald-500/80" />
              <span>More</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
