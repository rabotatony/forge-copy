"use client";

import {
  Activity,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Zap,
  ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSystemStats,
  type ActivityItem,
} from "./use-forge-api";
import { StatusBadge } from "./status-badge";
import { KindBadge } from "./status-badge";
import { formatDuration, formatRelativeTime } from "./format";
import { renderWorkflowIcon } from "./icon-map";

/**
 * SystemStatsDashboard — global stats strip shown on the home page.
 * Surfaces total runs, success rate, avg duration, top workflows, and
 * recent activity so the user immediately sees the system is alive.
 */
export function SystemStatsDashboard() {
  const { data, isLoading } = useSystemStats();

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stat cards row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Total runs"
          value={data.totalRuns.toLocaleString()}
          sub={`${data.projects} project${data.projects === 1 ? "" : "s"}`}
          tone="default"
        />
        <StatCard
          icon={CheckCircle2}
          label="Success rate"
          value={`${data.successRate}%`}
          sub={`${data.successCount} ok · ${data.failedCount} failed`}
          tone={data.successRate >= 80 ? "success" : data.successRate >= 50 ? "warning" : "danger"}
        />
        <StatCard
          icon={Clock}
          label="Avg duration"
          value={formatDuration(data.avgDurationMs)}
          sub="across completed runs"
          tone="default"
        />
        <StatCard
          icon={Loader2}
          label="Active now"
          value={data.runningCount.toString()}
          sub={data.runningCount > 0 ? "running" : "idle"}
          tone={data.runningCount > 0 ? "warning" : "muted"}
          pulse={data.runningCount > 0}
        />
      </div>

      {/* Top workflows + recent activity */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Top workflows */}
        {data.topWorkflows.length > 0 && (
          <Card>
            <CardHeader className="gap-1 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
                Most used workflows
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-1.5">
                {data.topWorkflows.map((w, idx) => {
                  const maxCount = data.topWorkflows[0]?.count ?? 1;
                  const pct = Math.round((w.count / maxCount) * 100);
                  return (
                    <li key={w.workflow} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground">
                        {renderWorkflowIcon(
                          // Try to map the workflow key to an icon via the catalog.
                          // Falls back to a generic icon if unknown.
                          w.workflow === "build-apk" ? "Smartphone" :
                          w.workflow === "install" ? "Package" :
                          w.workflow === "build" ? "Hammer" :
                          w.workflow === "test" ? "FlaskConical" :
                          w.workflow === "inspect" ? "Search" :
                          w.workflow === "parse" ? "GitFork" :
                          w.workflow === "bundle" ? "Box" :
                          w.workflow === "lint" ? "ScanLine" : "FileCode",
                          "size-3.5",
                        )}
                      </div>
                      <span className="w-28 shrink-0 truncate font-mono text-xs">
                        {w.workflow}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5, delay: idx * 0.05 }}
                          className="h-full rounded-full bg-emerald-500"
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">
                        {w.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Recent activity */}
        {data.recentActivity.length > 0 && (
          <Card>
            <CardHeader className="gap-1 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Zap className="size-4 text-muted-foreground" aria-hidden />
                Recent activity
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="max-h-48 space-y-1.5 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                {data.recentActivity.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
  pulse,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "warning" | "danger" | "muted";
  pulse?: boolean;
}) {
  const toneClasses = {
    default: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
    muted: "text-muted-foreground",
  } as const;
  const iconBg = {
    default: "bg-muted text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
    muted: "bg-muted text-muted-foreground",
  } as const;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 p-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", iconBg[tone])}>
          <Icon
            className={cn("size-5", pulse && "animate-pulse")}
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className={cn("text-lg font-bold tabular-nums leading-tight", toneClasses[tone])}>
            {value}
          </div>
          {sub && (
            <div className="truncate text-[10px] text-muted-foreground">
              {sub}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const isSuccess = item.status === "success";
  const isFailed = item.status === "failed";
  const isRunning = item.status === "running" || item.status === "queued";

  return (
    <li className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/50">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isSuccess
            ? "bg-emerald-500"
            : isFailed
              ? "bg-red-500"
              : isRunning
                ? "bg-amber-500 animate-pulse"
                : "bg-zinc-400",
        )}
        aria-hidden
      />
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {renderWorkflowIcon(
          item.workflow === "build-apk" ? "Smartphone" :
          item.workflow === "install" ? "Package" :
          item.workflow === "build" ? "Hammer" :
          item.workflow === "test" ? "FlaskConical" :
          item.workflow === "inspect" ? "Search" :
          item.workflow === "parse" ? "GitFork" :
          item.workflow === "bundle" ? "Box" :
          item.workflow === "lint" ? "ScanLine" : "FileCode",
          "size-3.5",
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs">
        {item.workflow}
      </span>
      <KindBadge kind={item.projectKind} />
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {formatRelativeTime(item.startedAt)}
      </span>
    </li>
  );
}
