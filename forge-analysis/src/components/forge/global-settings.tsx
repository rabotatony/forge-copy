"use client";

import { lazy, Suspense, type ReactNode } from "react";
import {
  Activity,
  Clock,
  Database,
  Download,
  HardDrive,
  Info,
  Key,
  Loader2,
  Server,
  Settings,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration } from "./format";

// ---------------------------------------------------------------------------
// Lazy-load the ApiTokensPanel — it ships a Dialog + form and only needs to
// hit the client bundle when the Settings page is actually opened.
// ---------------------------------------------------------------------------
const ApiTokensPanel = lazy(() =>
  import("./api-tokens-panel").then((m) => ({ default: m.ApiTokensPanel })),
);

import { GitHubSettings } from "./github-settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape returned by GET /api/forge/stats. Only the fields we read are
 * declared; `dbSizeBytes` is optional because the API may not include it
 * (we estimate locally in that case).
 */
interface SystemStats {
  projects: number;
  totalRuns: number;
  recentRuns: number;
  successCount: number;
  failedCount: number;
  canceledCount: number;
  runningCount: number;
  successRate: number;
  avgDurationMs: number;
  topWorkflows: { workflow: string; count: number }[];
  recentActivity: unknown[];
  dbSizeBytes?: number;
}

type Tone = "default" | "success" | "warning" | "danger" | "muted";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_VERSION = "Forge v38";

/**
 * Node.js version. `NEXT_PUBLIC_NODE_VERSION` is inlined at build time when
 * present; otherwise we fall back to "N/A". The `typeof process` guard keeps
 * this safe even if the bundle ever runs in a non-Node context.
 */
const NODE_VERSION: string =
  typeof process !== "undefined" &&
  process.env &&
  typeof process.env.NEXT_PUBLIC_NODE_VERSION === "string"
    ? process.env.NEXT_PUBLIC_NODE_VERSION
    : "N/A";

// Retention policy is currently fixed — surfaced here for transparency.
const RETENTION = {
  days: 30,
  runsPerProject: 500,
  logLinesPerRun: 10_000,
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GlobalSettings — system-wide settings surface for the Forge dashboard.
 *
 * Three sections:
 *   1. API Tokens        — reuses ApiTokensPanel (lazy + Suspense)
 *   2. System Information — live stats + version info from /api/forge/stats
 *   3. Data Management    — retention policy, cache clear, data export
 *
 * Color convention: emerald accents only — never indigo or blue.
 */
export function GlobalSettings() {
  const qc = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ["forge", "stats"],
    queryFn: async (): Promise<SystemStats> => {
      const r = await fetch("/api/forge/stats");
      if (!r.ok) {
        throw new Error(`Failed to load system stats (${r.status})`);
      }
      return (await r.json()) as SystemStats;
    },
    refetchInterval: 30_000,
  });

  const clearCachesMutation = useMutation({
    mutationFn: async () => {
      // Endpoint is not implemented server-side yet — we still attempt the
      // DELETE so the moment it lands, this button starts working. Errors
      // are surfaced via toast.
      const r = await fetch("/api/forge/projects", { method: "DELETE" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Clear caches failed (${r.status})`);
      }
      return r.json().catch(() => ({}));
    },
    onSuccess: () => {
      toast.success("Caches cleared");
      qc.invalidateQueries({ queryKey: ["forge"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Settings className="size-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Global Settings</h2>
          <p className="text-sm text-muted-foreground">
            System-wide configuration, tokens, and data management.
          </p>
        </div>
      </div>

      {/* Section 1: API Tokens */}
      <section className="space-y-2">
        <SectionHeading
          icon={Key}
          title="API Tokens"
          description="Manage external access tokens for the Forge API."
        />
        <Suspense
          fallback={
            <Card>
              <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading API tokens…
              </CardContent>
            </Card>
          }
        >
          <ApiTokensPanel />
        </Suspense>
      </section>

      {/* Section 2: System Information */}
      <section className="space-y-2">
        <SectionHeading
          icon={Server}
          title="System Information"
          description="Live system stats and version info, refreshed every 30s."
        />
        {statsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : statsQuery.isError || !statsQuery.data ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-6 text-sm text-red-600 dark:text-red-400">
              <Info className="size-4" aria-hidden />
              Failed to load system stats.
            </CardContent>
          </Card>
        ) : (
          <SystemInfoGrid data={statsQuery.data} />
        )}
      </section>

      {/* Section 3: Data Management */}
      <section className="space-y-2">
        <SectionHeading
          icon={Database}
          title="Data Management"
          description="Retention policy, cache controls, and data export."
        />
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4 text-muted-foreground" aria-hidden />
              Retention Policy
            </CardTitle>
            <CardDescription>
              Forge automatically prunes old data to keep the database small.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <RetentionPolicyRow
                icon={Clock}
                label="Run age"
                value={`${RETENTION.days} days`}
                hint="Runs older than this are deleted"
              />
              <RetentionPolicyRow
                icon={Activity}
                label="Runs per project"
                value={RETENTION.runsPerProject.toLocaleString()}
                hint="Beyond this, oldest are pruned"
              />
              <RetentionPolicyRow
                icon={Info}
                label="Log lines per run"
                value={RETENTION.logLinesPerRun.toLocaleString()}
                hint="Tail kept; rest dropped"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => clearCachesMutation.mutate()}
                disabled={clearCachesMutation.isPending}
                className="text-red-600 hover:text-red-700 hover:border-red-400/60 dark:text-red-400 dark:hover:text-red-300"
              >
                {clearCachesMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Clear all caches
              </Button>
              <Button
                variant="outline"
                onClick={() => toast.info("Coming soon")}
                className="text-emerald-600 hover:text-emerald-700 hover:border-emerald-400/60 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                <Download className="size-4" />
                Export all data
              </Button>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
              <Info
                className="mt-0.5 size-4 shrink-0 text-amber-500"
                aria-hidden
              />
              <p>
                <span className="font-medium">Warning:</span> clearing caches
                invalidates all saved pipeline caches across every project.
                Exported data includes projects, runs, logs, and settings. Old
                runs are pruned automatically based on the retention policy
                above.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* GitHub Integration */}
      <section className="space-y-3">
        <GitHubSettings />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Settings;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon
        className="size-4 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SystemInfoGrid({ data }: { data: SystemStats }) {
  // Estimate DB size when the API doesn't return one. Rough heuristic:
  // each project ~50 KB, each run ~2 KB. Display only — never used for logic.
  const estimatedDbBytes =
    data.dbSizeBytes ?? data.projects * 50_000 + data.totalRuns * 2_048;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        icon={Database}
        label="Projects"
        value={data.projects.toLocaleString()}
        sub="tracked projects"
      />
      <StatCard
        icon={Activity}
        label="Total runs"
        value={data.totalRuns.toLocaleString()}
        sub={`${data.runningCount} active now`}
        tone={data.runningCount > 0 ? "warning" : "default"}
        pulse={data.runningCount > 0}
      />
      <StatCard
        icon={HardDrive}
        label="Success rate"
        value={`${data.successRate}%`}
        sub={`${data.successCount} ok · ${data.failedCount} failed`}
        tone={
          data.successRate >= 80
            ? "success"
            : data.successRate >= 50
              ? "warning"
              : "danger"
        }
      />
      <StatCard
        icon={Clock}
        label="Avg duration"
        value={formatDuration(data.avgDurationMs)}
        sub="across completed runs"
      />

      {/* Second row: version + db size */}
      <StatCard
        icon={Server}
        label="Server version"
        value={SERVER_VERSION}
        sub="stable"
        tone="success"
        badge={<Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">stable</Badge>}
      />
      <StatCard
        icon={Info}
        label="Node.js"
        value={NODE_VERSION}
        sub="runtime"
      />
      <StatCard
        icon={HardDrive}
        label="Database size"
        value={formatBytes(estimatedDbBytes)}
        sub="estimated"
      />
      <StatCard
        icon={Activity}
        label="Active runs"
        value={data.runningCount.toString()}
        sub={data.runningCount > 0 ? "in progress" : "idle"}
        tone={data.runningCount > 0 ? "warning" : "muted"}
        pulse={data.runningCount > 0}
      />
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
  badge,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  pulse?: boolean;
  badge?: ReactNode;
}) {
  const toneText: Record<Tone, string> = {
    default: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
    muted: "text-muted-foreground",
  };
  const iconBg: Record<Tone, string> = {
    default: "bg-muted text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
    muted: "bg-muted text-muted-foreground",
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 p-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            iconBg[tone],
          )}
        >
          <Icon
            className={cn("size-5", pulse && "animate-pulse")}
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            {badge}
          </div>
          <div
            className={cn(
              "text-lg font-bold tabular-nums leading-tight",
              toneText[tone],
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

function RetentionPolicyRow({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-base font-semibold tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}
