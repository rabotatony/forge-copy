"use client";

// ============================================================
// RunStatsChart — pure-CSS stacked bar chart visualizing run
// success/failure trends across ALL projects over the last 30
// days. Each thin vertical bar represents one UTC day; bar height
// is proportional to that day's total run count, with stacked
// segments colored by outcome:
//   - success  → emerald (bottom)
//   - failed   → red
//   - canceled → zinc
//   - running  → amber (top)
//
// Hover any bar for a compact tooltip ("2026-07-24: 5 success,
// 2 failed"). Below the chart: total runs, average per day, best
// day, and worst day summary Badges. No chart library — bars are
// plain divs with inline height styles.
// ============================================================

import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Calendar,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface RunStatsDay {
  date: string;
  total: number;
  success: number;
  failed: number;
  canceled: number;
  running: number;
}

interface RunStatsResponse {
  days: RunStatsDay[];
}

type SegmentKey = "success" | "failed" | "canceled" | "running";

interface SegmentDef {
  key: SegmentKey;
  label: string;
  barClass: string;
  dotClass: string;
}

// Bottom-up visual order (success anchored at the bottom, running
// on top). The DOM order matches this list and the container uses
// `flex-col-reverse` so the first entry ends up at the bottom.
const SEGMENTS: SegmentDef[] = [
  {
    key: "success",
    label: "success",
    barClass: "bg-emerald-500",
    dotClass: "bg-emerald-500",
  },
  {
    key: "failed",
    label: "failed",
    barClass: "bg-red-500",
    dotClass: "bg-red-500",
  },
  {
    key: "canceled",
    label: "canceled",
    barClass: "bg-zinc-400 dark:bg-zinc-500",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
  },
  {
    key: "running",
    label: "running",
    barClass: "bg-amber-500",
    dotClass: "bg-amber-500",
  },
];

/**
 * Build the hover tooltip. Only includes non-zero segments so a
 * clean-success day reads as "2026-07-24: 5 success" rather than
 * padding with "0 failed, 0 canceled, 0 running".
 */
function buildTooltip(day: RunStatsDay): string {
  const parts: string[] = [];
  if (day.success > 0) parts.push(`${day.success} success`);
  if (day.failed > 0) parts.push(`${day.failed} failed`);
  if (day.canceled > 0) parts.push(`${day.canceled} canceled`);
  if (day.running > 0) parts.push(`${day.running} running`);
  const body = parts.length > 0 ? parts.join(", ") : "no runs";
  return `${day.date}: ${body}`;
}

/** Strip the year off a YYYY-MM-DD date for compact display ("07-24"). */
function shortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(5) : iso;
}

export function RunStatsChart() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "run-stats"],
    queryFn: async () => {
      const r = await fetch("/api/forge/run-stats");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Run stats fetch failed (${r.status})`,
        );
      }
      return (await r.json()) as RunStatsResponse;
    },
    staleTime: 60_000,
    retry: false,
  });

  const days = data?.days ?? [];
  const maxTotal = days.reduce((m, d) => Math.max(m, d.total), 0);

  // Summary metrics.
  const totalRuns = days.reduce((s, d) => s + d.total, 0);
  const avgPerDay = days.length > 0 ? totalRuns / days.length : 0;

  // Best day = highest success count (tiebreak: highest total).
  let bestDay: RunStatsDay | null = null;
  for (const d of days) {
    if (
      !bestDay ||
      d.success > bestDay.success ||
      (d.success === bestDay.success && d.total > bestDay.total)
    ) {
      bestDay = d;
    }
  }

  // Worst day = highest failed count (tiebreak: highest total).
  let worstDay: RunStatsDay | null = null;
  for (const d of days) {
    if (
      !worstDay ||
      d.failed > worstDay.failed ||
      (d.failed === worstDay.failed && d.total > worstDay.total)
    ) {
      worstDay = d;
    }
  }

  const hasBest = !!bestDay && bestDay.success > 0;
  const hasWorst = !!worstDay && worstDay.failed > 0;

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-emerald-500" />
          Run Statistics
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            <Calendar className="size-3" />
            Last 30 days
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-emerald-500" />
            Loading run statistics…
          </div>
        ) : isError ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error instanceof Error
              ? error.message
              : "Failed to load run statistics"}
          </div>
        ) : days.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <BarChart3 className="size-4" />
            No run data available.
          </div>
        ) : (
          <>
            {/* Stacked bar chart — each day = one thin vertical bar. */}
            <div className="flex h-40 w-full items-end gap-0.5 rounded-lg border bg-muted/20 p-2">
              {days.map((day) => {
                const barHeightPct =
                  maxTotal > 0 ? (day.total / maxTotal) * 100 : 0;
                return (
                  <div
                    key={day.date}
                    className="group relative flex h-full flex-1 items-end justify-center"
                  >
                    <div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm transition-all duration-300"
                      style={{ height: `${barHeightPct}%` }}
                    >
                      {SEGMENTS.map((seg) => {
                        const pct =
                          day.total > 0
                            ? (day[seg.key] / day.total) * 100
                            : 0;
                        // Skip zero-height segments so the rounded
                        // top stays on the highest visible segment.
                        if (pct <= 0) return null;
                        return (
                          <div
                            key={seg.key}
                            className={cn("w-full", seg.barClass)}
                            style={{ height: `${pct}%` }}
                          />
                        );
                      })}
                    </div>
                    {/* Hover tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-md group-hover:block">
                      {buildTooltip(day)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Color legend */}
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              {SEGMENTS.map((seg) => (
                <span key={seg.key} className="flex items-center gap-1">
                  <span
                    className={cn("size-2 rounded-sm", seg.dotClass)}
                  />
                  {seg.label}
                </span>
              ))}
            </div>

            {/* Summary stat Badges */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryStat
                icon={<BarChart3 className="size-3.5" />}
                label="Total runs"
                value={totalRuns.toLocaleString()}
              />
              <SummaryStat
                icon={<Calendar className="size-3.5" />}
                label="Avg / day"
                value={avgPerDay.toFixed(1)}
              />
              <SummaryStat
                icon={
                  <TrendingUp className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                }
                label="Best day"
                value={hasBest ? `${bestDay!.success} ok` : "—"}
                sub={hasBest ? shortDate(bestDay!.date) : "no successes"}
                tone="success"
              />
              <SummaryStat
                icon={
                  <TrendingDown className="size-3.5 text-red-600 dark:text-red-400" />
                }
                label="Worst day"
                value={hasWorst ? `${worstDay!.failed} failed` : "—"}
                sub={hasWorst ? shortDate(worstDay!.date) : "no failures"}
                tone="danger"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface SummaryStatProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "danger";
}

function SummaryStat({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: SummaryStatProps) {
  const toneClasses = {
    default: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    danger: "text-red-600 dark:text-red-400",
  } as const;

  return (
    <Badge
      variant="outline"
      className="h-auto flex-col items-start gap-0.5 px-2.5 py-1.5"
    >
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className={cn("text-sm font-semibold tabular-nums", toneClasses[tone])}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[9px] tabular-nums text-muted-foreground">
          {sub}
        </span>
      )}
    </Badge>
  );
}
