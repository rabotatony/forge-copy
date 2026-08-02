"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, GitBranch, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogLine {
  seq: number;
  stream: string;
  text: string;
  ts: string;
}

interface LogsResponse {
  logs: LogLine[];
  truncated: boolean;
  total: number;
}

type StepStatus = "success" | "failed" | "retried" | "running";

interface TimelineStep {
  name: string;
  startSeq: number;
  endSeq: number;
  status: StepStatus;
  retries: number;
}

interface StepStyle {
  bar: string;
  text: string;
  dot: string;
  label: string;
  pulse?: boolean;
}

// ---------------------------------------------------------------------------
// Color map — emerald (success), red (failed), amber (retry), zinc (running).
// Never indigo or blue.
// ---------------------------------------------------------------------------
const STATUS_STYLES: Record<StepStatus, StepStyle> = {
  success: {
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    label: "success",
  },
  failed: {
    bar: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
    label: "failed",
  },
  retried: {
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    label: "retried",
  },
  running: {
    bar: "bg-zinc-400 dark:bg-zinc-500",
    text: "text-zinc-500 dark:text-zinc-400",
    dot: "bg-zinc-400 dark:bg-zinc-500",
    label: "running",
    pulse: true,
  },
};

// ---------------------------------------------------------------------------
// Step timeline parser
// ---------------------------------------------------------------------------
//
// Walks the system log stream in `seq` order and reconstructs a list of
// steps with start/end seq numbers, final status, and retry count.
//
// Markers (emitted by src/lib/forge/engine.ts and custom-workflow.ts):
//   ▶ <name>               step start
//   ✓ <name>               step end (success)
//   ✗ Step failed with...  step end (failed) — closes the most recent open step
//   ↻ Retry a/b for: <n>   retry marker — increments the current step's retry count
//
// Meta lines that share the ▶ / ✓ / ✗ prefix but are NOT real step boundaries
// (e.g. "▶ Run started…", "✓ Approved by…", "✗ Rejected by…") are skipped.
//
// Multi-attempt steps collapse into a single TimelineStep: the original
// startSeq is preserved, retries are counted from the ↻ markers, and the
// ✓ / ✗ of the final attempt provides endSeq + status.
// ---------------------------------------------------------------------------
function parseTimeline(logs: LogLine[]): TimelineStep[] {
  const steps: TimelineStep[] = [];
  let current: TimelineStep | null = null;

  const closeCurrent = (endSeq: number, status: StepStatus): void => {
    if (!current) return;
    current.endSeq = endSeq;
    current.status = status;
    steps.push(current);
    current = null;
  };

  for (const log of logs) {
    if (log.stream !== "system") continue;
    const text = log.text;

    if (text.startsWith("▶ ")) {
      const name = text.slice(2).trim();
      // Skip generic run-lifecycle messages (e.g. "▶ Run started…").
      if (name.startsWith("Run started")) {
        if (current) {
          closeCurrent(
            log.seq - 1,
            current.retries > 0 ? "retried" : "success",
          );
        }
        continue;
      }
      if (current) {
        if (current.name === name) {
          // Another attempt of the same step — keep the original start; the
          // retry was already counted by the preceding ↻ marker.
          continue;
        }
        // Different step started — close the previous one. If no explicit
        // end marker was emitted, assume success (or retried if retries>0).
        closeCurrent(
          log.seq - 1,
          current.retries > 0 ? "retried" : "success",
        );
      }
      current = {
        name,
        startSeq: log.seq,
        endSeq: log.seq,
        status: "running",
        retries: 0,
      };
    } else if (text.startsWith("✓ ")) {
      const name = text.slice(2).trim();
      // Skip approval meta messages.
      if (name.startsWith("Approved by")) continue;
      if (current) {
        closeCurrent(
          log.seq,
          current.retries > 0 ? "retried" : "success",
        );
      }
    } else if (text.startsWith("✗ ")) {
      const rest = text.slice(2).trim();
      // Skip rejection meta messages.
      if (rest.startsWith("Rejected by")) continue;
      if (current) {
        closeCurrent(log.seq, "failed");
      }
    } else if (text.startsWith("↻ ")) {
      // Retry marker — refers to the step currently in progress (the ↻ is
      // emitted just before the next ▶ of the same step).
      if (current) {
        current.retries += 1;
      }
    }
  }

  // Any remaining open step is still running. Use the last log seq as its
  // (provisional) end so its bar shows up to "now".
  if (current) {
    const lastSeq = logs.length > 0 ? logs[logs.length - 1].seq : current.startSeq;
    current.endSeq = Math.max(lastSeq, current.startSeq);
    current.status = "running";
    steps.push(current);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * RunTimeline — Gantt-style visualization of step durations for a single run.
 *
 * Fetches run logs from `/api/forge/runs/${runId}/logs`, parses the system
 * log stream to reconstruct step start/end boundaries (▶ / ✓ / ✗ / ↻), and
 * renders a horizontal bar for each step:
 *   - Bar width is proportional to step duration (seq difference)
 *   - Bar offset within the track shows when the step started
 *   - Emerald = success, red = failed, amber = retried, zinc = still running
 *   - Total run duration (seq span) is shown in a banner at the top
 *
 * Per the spec, `log.seq` is used as a proxy for time ordering (instead of
 * the wall-clock `ts` field), so all "durations" are in seq-event units.
 *
 * Never uses indigo or blue.
 */
export function RunTimeline({ runId }: { runId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "runs", runId, "timeline"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/runs/${runId}/logs`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to fetch logs (${r.status})`);
      }
      return (await r.json()) as LogsResponse;
    },
    staleTime: 30_000,
    retry: false,
  });

  const steps = useMemo(
    () => (data ? parseTimeline(data.logs) : []),
    [data],
  );

  // Total run duration = seq span from first step start to last step end.
  const { totalSpan, maxDuration, runStartSeq } = useMemo(() => {
    if (steps.length === 0) {
      return { totalSpan: 0, maxDuration: 0, runStartSeq: 0 };
    }
    const start = Math.min(...steps.map((s) => s.startSeq));
    const end = Math.max(...steps.map((s) => s.endSeq));
    const max = steps.reduce((m, s) => Math.max(m, s.endSeq - s.startSeq), 0);
    return { totalSpan: Math.max(0, end - start), maxDuration: max, runStartSeq: start };
  }, [steps]);

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading run timeline…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader className="gap-1 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-red-500" />
            Run Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Failed to load run timeline."}
        </CardContent>
      </Card>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-emerald-500" />
          Run Timeline
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            <GitBranch className="size-3" />
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total run duration banner */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Clock className="size-3.5" />
            Total Run Duration
          </div>
          <div className="text-sm font-semibold tabular-nums">
            {totalSpan} {totalSpan === 1 ? "event" : "events"}
            {data.truncated && (
              <span className="ml-2 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                (truncated)
              </span>
            )}
          </div>
        </div>

        {steps.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Activity className="size-4" />
            No step events found in run logs.
          </div>
        ) : (
          <div className="space-y-2.5">
            {steps.map((step, idx) => {
              const style = STATUS_STYLES[step.status];
              const duration = Math.max(0, step.endSeq - step.startSeq);
              // Width proportional to step duration (relative to longest step).
              const widthPct =
                maxDuration > 0 ? Math.max(2, (duration / maxDuration) * 100) : 100;
              // Offset within the track shows when the step started (Gantt-style).
              const offsetPct =
                totalSpan > 0
                  ? ((step.startSeq - runStartSeq) / totalSpan) * 100
                  : 0;
              const tooltip =
                `${step.name} · ${duration} ${duration === 1 ? "event" : "events"} · ${style.label}` +
                (step.retries > 0
                  ? ` · ${step.retries} ${step.retries === 1 ? "retry" : "retries"}`
                  : "");

              return (
                <div key={`${idx}-${step.name}`} className="space-y-1">
                  {/* Row header: step name on the left, duration on the right */}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn("size-1.5 shrink-0 rounded-full", style.dot)}
                        aria-hidden
                      />
                      <span className="truncate font-medium" title={step.name}>
                        {step.name}
                      </span>
                      {step.retries > 0 && (
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold",
                            "text-amber-600 dark:text-amber-400",
                          )}
                        >
                          ↻ {step.retries}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {duration} {duration === 1 ? "event" : "events"}
                    </span>
                  </div>

                  {/* Gantt track — bar offset shows start, width shows duration */}
                  <div className="relative h-5 w-full overflow-hidden rounded-md bg-muted/40">
                    <div
                      className={cn(
                        "absolute top-0 h-full rounded-md transition-all",
                        style.bar,
                        style.pulse && "animate-pulse",
                      )}
                      style={{
                        left: `${offsetPct}%`,
                        width: `${widthPct}%`,
                      }}
                      title={tooltip}
                    />
                  </div>
                </div>
              );
            })}

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 pt-2 text-[10px] text-muted-foreground">
              {(["success", "failed", "retried", "running"] as StepStatus[]).map(
                (s) => (
                  <span key={s} className="flex items-center gap-1">
                    <span
                      className={cn(
                        "size-2 rounded-sm",
                        STATUS_STYLES[s].dot,
                        STATUS_STYLES[s].pulse && "animate-pulse",
                      )}
                    />
                    {STATUS_STYLES[s].label}
                  </span>
                ),
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
