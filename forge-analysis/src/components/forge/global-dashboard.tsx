"use client";

import { type ReactNode, Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";

// Lazy-load heavy dashboard sub-components.
const RunStatsChart = lazy(() => import("./run-stats-chart").then(m => ({ default: m.RunStatsChart })));
const ProjectComparison = lazy(() => import("./project-comparison").then(m => ({ default: m.ProjectComparison })));
const SystemLogsViewer = lazy(() => import("./system-logs-viewer").then(m => ({ default: m.SystemLogsViewer })));
import {
  LayoutDashboard,
  Activity,
  TrendingUp,
  Clock,
  FolderGit2,
  Zap,
  Store,
  Settings,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "./format";

// ---------------------------------------------------------------------------
// Types — mirror the API response shapes exactly so the component stays
// self-contained (no `any`).
// ---------------------------------------------------------------------------

type RunStatus = "queued" | "running" | "success" | "failed" | "canceled";
type ForgeKind = "node" | "python" | "rust" | "go" | "unknown";

interface ActivityItem {
  id: string;
  workflow: string;
  status: RunStatus;
  startedAt: string;
  durationMs: number | null;
  trigger: string | null;
  projectName: string;
  projectKind: ForgeKind;
}

interface TopWorkflow {
  workflow: string;
  count: number;
}

interface ForgeStats {
  projects: number;
  totalRuns: number;
  recentRuns?: number;
  successCount: number;
  failedCount: number;
  canceledCount?: number;
  runningCount?: number;
  successRate: number;
  avgDurationMs: number;
  topWorkflows: TopWorkflow[];
  recentActivity: ActivityItem[];
}

interface ProjectListItem {
  id: string;
  name: string;
  fileName: string;
  kind: ForgeKind;
  fileSize: number;
  fileCount: number;
  createdAt: string;
  runCount: number;
  lastRunStatus: RunStatus | null;
}

interface ProjectListResponse {
  projects: ProjectListItem[];
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore parse error */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

// Dispatch a global CustomEvent so the parent page (or any listener) can
// react to quick-action clicks without prop-drilling into this component.
function emitQuickAction(action: "upload" | "marketplace" | "settings") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("forge:quick-action", { detail: { action } }),
    );
  }
}

// ---------------------------------------------------------------------------
// GlobalDashboard — system-wide overview (not project-specific).
// Rendered in main page.tsx when the "dashboard" view is selected.
// ---------------------------------------------------------------------------

export function GlobalDashboard() {
  const statsQuery = useQuery({
    queryKey: ["forge", "stats"],
    queryFn: async () =>
      jsonOrThrow<ForgeStats>(await fetch("/api/forge/stats")),
    refetchInterval: 30_000,
  });

  const projectsQuery = useQuery({
    queryKey: ["forge", "projects"],
    queryFn: async () =>
      jsonOrThrow<ProjectListResponse>(await fetch("/api/forge/projects")),
    refetchInterval: 15_000,
  });

  const stats = statsQuery.data;
  const projects = projectsQuery.data?.projects ?? [];

  // Aggregate project file size + file count for the Total Projects card sub.
  const totalSizeBytes = projects.reduce(
    (sum, p) => sum + (p.fileSize ?? 0),
    0,
  );
  const totalFiles = projects.reduce(
    (sum, p) => sum + (p.fileCount ?? 0),
    0,
  );

  const isLoading = statsQuery.isLoading && !stats;
  const isError = statsQuery.isError;
  const error = statsQuery.error;

  if (isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
          Failed to load dashboard:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </CardContent>
      </Card>
    );
  }

  // Derive success-rate tone for the card.
  const rateTone: "default" | "success" | "warning" | "danger" = !stats
    ? "default"
    : stats.successRate >= 80
      ? "success"
      : stats.successRate >= 50
        ? "warning"
        : "danger";

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <LayoutDashboard className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            System-wide overview across all Forge projects
          </p>
        </div>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={FolderGit2}
          label="Total Projects"
          value={isLoading ? "—" : (stats?.projects ?? 0).toLocaleString()}
          sub={
            projects.length > 0
              ? `${formatBytes(totalSizeBytes)} · ${totalFiles.toLocaleString()} files`
              : "no projects yet"
          }
          tone="default"
        />
        <StatCard
          icon={Activity}
          label="Total Runs"
          value={isLoading ? "—" : (stats?.totalRuns ?? 0).toLocaleString()}
          sub={
            stats
              ? `${stats.successCount.toLocaleString()} ok · ${stats.failedCount.toLocaleString()} failed`
              : "loading…"
          }
          tone="default"
        />
        <StatCard
          icon={TrendingUp}
          label="Success Rate"
          value={isLoading ? "—" : `${stats?.successRate ?? 0}%`}
          sub={
            !stats
              ? "loading…"
              : stats.successRate >= 80
                ? "healthy"
                : stats.successRate >= 50
                  ? "needs attention"
                  : "critical"
          }
          tone={rateTone}
        />
        <StatCard
          icon={Clock}
          label="Avg Duration"
          value={isLoading ? "—" : formatDuration(stats?.avgDurationMs ?? 0)}
          sub="across completed runs"
          tone="default"
        />
      </div>

      {/* Recent activity + top workflows */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent activity feed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap
                className="size-4 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ActivitySkeleton />
            ) : !stats || stats.recentActivity.length === 0 ? (
              <EmptyState
                icon={<Zap className="size-5" aria-hidden />}
                title="No recent activity"
                description="Runs from any project will appear here."
              />
            ) : (
              <ul
                className="max-h-80 space-y-1 overflow-y-auto pr-1
                  [&::-webkit-scrollbar]:w-1.5
                  [&::-webkit-scrollbar-thumb]:rounded-full
                  [&::-webkit-scrollbar-thumb]:bg-border
                  [&::-webkit-scrollbar-track]:bg-transparent"
              >
                {stats.recentActivity.slice(0, 10).map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Top workflows chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp
                className="size-4 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              Top Workflows
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                    <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
                  </div>
                ))}
              </div>
            ) : !stats || stats.topWorkflows.length === 0 ? (
              <EmptyState
                icon={<TrendingUp className="size-5" aria-hidden />}
                title="No workflow usage yet"
                description="Run a workflow to see usage stats here."
              />
            ) : (
              <ul className="space-y-2.5">
                {stats.topWorkflows.map((w, idx) => {
                  const max = stats.topWorkflows[0]?.count ?? 1;
                  // Min width 4% so even tiny bars are visible.
                  const pct = Math.max(
                    4,
                    Math.round((w.count / max) * 100),
                  );
                  return (
                    <li key={w.workflow} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">
                            {idx + 1}.
                          </span>
                          <span className="truncate font-mono">
                            {w.workflow}
                          </span>
                        </span>
                        <Badge
                          variant="secondary"
                          className="shrink-0 tabular-nums"
                        >
                          {w.count}
                        </Badge>
                      </div>
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={w.count}
                        aria-valuemin={0}
                        aria-valuemax={max}
                        aria-label={`${w.workflow} usage`}
                      >
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <LayoutDashboard
              className="size-4 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => emitQuickAction("upload")}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Upload className="size-4" aria-hidden />
              Upload Project
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => emitQuickAction("marketplace")}
            >
              <Store className="size-4" aria-hidden />
              Browse Marketplace
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => emitQuickAction("settings")}
            >
              <Settings className="size-4" aria-hidden />
              View Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Run stats chart */}
      <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Loading chart…</div>}>
        <RunStatsChart />
      </Suspense>

      {/* Project comparison */}
      <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Loading comparison…</div>}>
        <ProjectComparison />
      </Suspense>

      {/* System logs */}
      <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Loading system logs…</div>}>
        <SystemLogsViewer />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type StatTone = "default" | "success" | "warning" | "danger";

interface StatCardProps {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: StatCardProps) {
  // Emerald is the brand accent; warning=amber, danger=red.
  const iconTone: Record<StatTone, string> = {
    default: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    danger: "bg-red-500/15 text-red-600 dark:text-red-400",
  };
  const valueTone: Record<StatTone, string> = {
    default: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
  };

  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            iconTone[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div
            className={cn(
              "text-lg font-bold leading-tight tabular-nums",
              valueTone[tone],
            )}
          >
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

  // Status colors: success=emerald, failed=red, running=amber.
  const statusIcon = isSuccess ? (
    <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
  ) : isFailed ? (
    <XCircle className="size-3.5 text-red-500" aria-hidden />
  ) : isRunning ? (
    <Loader2
      className="size-3.5 animate-spin text-amber-500"
      aria-hidden
    />
  ) : (
    <span className="size-2 rounded-full bg-zinc-400" aria-hidden />
  );

  const badgeClass = isSuccess
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : isFailed
      ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
      : isRunning
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-zinc-500/30 bg-zinc-500/10 text-muted-foreground";

  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50">
      <span className="shrink-0" aria-hidden>
        {statusIcon}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-mono text-xs">{item.workflow}</span>
        <span className="ml-1.5 truncate text-xs text-muted-foreground">
          on{" "}
          <span className="font-medium text-foreground">
            {item.projectName}
          </span>
        </span>
      </span>
      <Badge
        variant="outline"
        className={cn("shrink-0 text-[10px]", badgeClass)}
      >
        {item.status}
      </Badge>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {formatRelativeTime(item.startedAt)}
      </span>
    </li>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="size-3.5 animate-pulse rounded-full bg-muted" />
          <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-10 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
