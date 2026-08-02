"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDuration } from "./format";

interface RecentRun {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
}

interface ProjectDetailResponse {
  project?: unknown;
  suggestedWorkflows?: unknown;
  recentRuns: RecentRun[];
}

type BarColor = "emerald" | "red" | "amber" | "zinc";

interface BarStyle {
  barClass: string;
  dotClass: string;
  label: string;
  pulse?: boolean;
}

const STATUS_STYLES: Record<BarColor, BarStyle> = {
  emerald: {
    barClass: "bg-emerald-500",
    dotClass: "bg-emerald-500",
    label: "success",
  },
  red: {
    barClass: "bg-red-500",
    dotClass: "bg-red-500",
    label: "failed",
  },
  amber: {
    barClass: "bg-amber-500",
    dotClass: "bg-amber-500",
    label: "running",
    pulse: true,
  },
  zinc: {
    barClass: "bg-zinc-400 dark:bg-zinc-500",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    label: "canceled",
  },
};

/**
 * Maps any run status string to one of the four visible bar colors.
 * Unknown / pending statuses (queued, waiting_approval, …) fold into `zinc`
 * so they remain visible without breaking the color legend.
 */
function colorForStatus(status: string): BarColor {
  switch (status) {
    case "success":
      return "emerald";
    case "failed":
      return "red";
    case "running":
      return "amber";
    case "canceled":
      return "zinc";
    default:
      return "zinc";
  }
}

/**
 * Compact duration formatter for the hover tooltip — matches the spec
 * format "34ms" (no space) for sub-second values, then falls back to
 * the shared `formatDuration` helper for larger values.
 */
function tooltipDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return formatDuration(ms);
}

/**
 * DurationChart — pure-CSS bar chart showing how run durations change
 * over time. Each bar represents one run; height is proportional to
 * `durationMs` (tallest bar = longest run). Bars are colored by status:
 * emerald (success), red (failed), amber (running), zinc (canceled).
 *
 * Hover any bar for a tooltip: "{workflow} · {duration} · {status}".
 * Auto-refreshes the project endpoint every 10 seconds.
 */
export function DurationChart({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["forge", "projects", projectId, "duration"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}`);
      return (await r.json()) as ProjectDetailResponse;
    },
    refetchInterval: 10_000,
  });

  // Take up to 30 most-recent runs, then reverse so the oldest is on the left.
  const runs = (data?.recentRuns ?? []).slice(0, 30).slice().reverse();

  const maxDuration = runs.reduce(
    (max, r) => Math.max(max, r.durationMs ?? 0),
    0,
  );

  const durations = runs
    .map((r) => r.durationMs)
    .filter((d): d is number => d != null);
  const avgDuration =
    durations.length === 0
      ? null
      : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4 text-emerald-500" />
          Run Duration Trend
          <span className="ml-auto inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {runs.length} {runs.length === 1 ? "run" : "runs"}
          </span>
        </CardTitle>
        <CardDescription>
          Run duration over time. Bars colored by status. Hover for details.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading duration trend…
          </div>
        ) : runs.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <TrendingUp className="size-4" />
            No runs yet for this project.
          </div>
        ) : (
          <>
            {/* Chart area — bars are anchored to the bottom via items-end.
                Each bar's height is `durationMs / maxDuration * 100%`. */}
            <div className="flex h-40 w-full items-end gap-1 rounded-lg border bg-muted/20 p-2">
              {runs.map((run, idx) => {
                const color = colorForStatus(run.status);
                const style = STATUS_STYLES[color];
                const dur = run.durationMs ?? 0;
                const pct = maxDuration > 0 ? (dur / maxDuration) * 100 : 0;
                const tooltip = `${run.workflow} · ${tooltipDuration(run.durationMs)} · ${style.label}`;
                return (
                  <div
                    key={run.id}
                    className="group relative flex h-full flex-1 items-end justify-center"
                  >
                    <div
                      className={cn(
                        "w-full rounded-t-sm transition-all duration-300",
                        style.barClass,
                        style.pulse && "animate-pulse",
                      )}
                      style={{ height: `${pct}%` }}
                      title={tooltip}
                    />
                    {/* Hover tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-md group-hover:block">
                      {tooltip}
                    </div>
                    {/* X-axis label — run number (oldest = 1, leftmost) */}
                    <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground">
                      {idx + 1}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Stats row — average duration + color legend */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Average
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatDuration(avgDuration)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                {(["emerald", "red", "amber", "zinc"] as BarColor[]).map(
                  (c) => (
                    <span key={c} className="flex items-center gap-1">
                      <span
                        className={cn(
                          "size-2 rounded-sm",
                          STATUS_STYLES[c].dotClass,
                          STATUS_STYLES[c].pulse && "animate-pulse",
                        )}
                      />
                      {STATUS_STYLES[c].label}
                    </span>
                  ),
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
