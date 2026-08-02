"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

type BucketKey = "running" | "queued" | "success" | "failed" | "canceled";

interface BucketConfig {
  key: BucketKey;
  label: string;
  icon: typeof Activity;
  dotClass: string;
  barClass: string;
  textClass: string;
  badgeClass: string;
  pulse?: boolean;
}

const BUCKETS: BucketConfig[] = [
  {
    key: "running",
    label: "Running",
    icon: Activity,
    dotClass: "bg-amber-500",
    barClass: "bg-amber-500",
    textClass: "text-amber-500",
    badgeClass:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    pulse: true,
  },
  {
    key: "queued",
    label: "Queued",
    icon: Clock,
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    barClass: "bg-zinc-400 dark:bg-zinc-500",
    textClass: "text-zinc-400 dark:text-zinc-500",
    badgeClass:
      "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/20",
  },
  {
    key: "success",
    label: "Success",
    icon: CheckCircle2,
    dotClass: "bg-emerald-500",
    barClass: "bg-emerald-500",
    textClass: "text-emerald-500",
    badgeClass:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  {
    key: "failed",
    label: "Failed",
    icon: XCircle,
    dotClass: "bg-red-500",
    barClass: "bg-red-500",
    textClass: "text-red-500",
    badgeClass:
      "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  {
    key: "canceled",
    label: "Canceled",
    icon: Clock,
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    barClass: "bg-zinc-400 dark:bg-zinc-500",
    textClass: "text-zinc-400 dark:text-zinc-500",
    badgeClass:
      "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/20",
  },
];

/**
 * Maps any run status string to one of the five visible buckets.
 * `waiting_approval` is folded into the `queued` column (it is a pending state).
 * Unknown statuses default to `queued` so they remain visible.
 */
function bucketForStatus(status: string): BucketKey {
  switch (status) {
    case "running":
      return "running";
    case "queued":
    case "waiting_approval":
      return "queued";
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return "queued";
  }
}

/**
 * RunQueuePanel — kanban-style visualization of a project's recent runs grouped by status.
 *
 * Renders a horizontal stacked status bar (proportional segments per status) plus a
 * 5-column kanban board (running / queued / success / failed / canceled). Each column
 * shows an icon, a count badge, a mini relative-count bar, and one colored dot per run.
 * Polls the project endpoint every 10 seconds.
 */
export function RunQueuePanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["forge", "projects", projectId, "queue"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}`);
      return (await r.json()) as ProjectDetailResponse;
    },
    refetchInterval: 10_000,
  });

  const runs = data?.recentRuns ?? [];

  const grouped: Record<BucketKey, RecentRun[]> = {
    running: [],
    queued: [],
    success: [],
    failed: [],
    canceled: [],
  };
  for (const run of runs) {
    grouped[bucketForStatus(run.status)].push(run);
  }

  const total = runs.length;
  const maxCount = Math.max(1, ...BUCKETS.map((b) => grouped[b.key].length));

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-muted-foreground" />
          Run Queue
          <span className="ml-auto inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {total} {total === 1 ? "run" : "runs"}
          </span>
        </CardTitle>
        <CardDescription>
          Run distribution by status. Auto-refreshes every 10s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading run queue…
          </div>
        ) : total === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Layers className="size-4" />
            No runs yet for this project.
          </div>
        ) : (
          <>
            {/* Horizontal stacked status bar — proportional segment per status */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {BUCKETS.map((bucket) => {
                const count = grouped[bucket.key].length;
                if (count === 0) return null;
                const pct = (count / total) * 100;
                return (
                  <div
                    key={bucket.key}
                    className={cn(
                      "h-full transition-all duration-300",
                      bucket.barClass,
                      bucket.pulse && "animate-pulse",
                    )}
                    style={{ width: `${pct}%` }}
                    title={`${bucket.label}: ${count}`}
                  />
                );
              })}
            </div>

            {/* Kanban columns — one per status */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {BUCKETS.map((bucket) => {
                const items = grouped[bucket.key];
                const count = items.length;
                const heightPct = (count / maxCount) * 100;
                const Icon = bucket.icon;
                return (
                  <div
                    key={bucket.key}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Icon
                          className={cn(
                            "size-3.5 shrink-0",
                            bucket.textClass,
                          )}
                        />
                        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {bucket.label}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                          bucket.badgeClass,
                          count === 0 && "opacity-40",
                        )}
                      >
                        {count}
                      </span>
                    </div>

                    {/* Mini bar showing relative count vs the busiest column */}
                    <div className="relative h-10 w-full overflow-hidden rounded-md bg-muted">
                      <div
                        className={cn(
                          "absolute inset-x-0 bottom-0 transition-all duration-300",
                          bucket.barClass,
                          bucket.pulse && "animate-pulse",
                        )}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>

                    {/* Colored dots — one per run */}
                    <div className="flex min-h-4 flex-wrap gap-1">
                      {items.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground/50">
                          —
                        </span>
                      ) : (
                        items.map((run) => (
                          <span
                            key={run.id}
                            title={`${run.workflow} • ${run.status}`}
                            className={cn(
                              "size-2.5 rounded-full",
                              bucket.dotClass,
                              bucket.pulse && "animate-pulse",
                            )}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
