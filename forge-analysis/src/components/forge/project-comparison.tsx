"use client";

// ============================================================
// ProjectComparison — side-by-side stat comparison between two
// projects. Lets users pick Project A and Project B from the
// catalog, then compares health score, total runs + success
// rate, file count + lines of code, dependencies, and top
// language. Winner gets an emerald Trophy badge; loser gets a
// zinc-muted cell. No indigo or blue anywhere.
// ============================================================

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GitCompare,
  Trophy,
  FolderGit2,
  Activity,
  Code2,
  Package,
  Loader2,
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

// ============================================================
// Types — mirror the Forge API contract (kept local so this
// file stays self-contained; no `any` used anywhere).
// ============================================================

type Grade = "A" | "B" | "C" | "D" | "F";

interface ProjectListItem {
  id: string;
  name: string;
  fileName: string;
  kind: string;
  fileSize: number;
  fileCount: number;
  createdAt: string;
  runCount: number;
  lastRunStatus: string | null;
}

interface ProjectsResponse {
  projects: ProjectListItem[];
}

interface GlobalStats {
  projects: number;
  totalRuns: number;
  recentRuns: number;
  successCount: number;
  failedCount: number;
  canceledCount: number;
  runningCount: number;
  successRate: number;
  avgDurationMs: number;
}

interface HealthFactor {
  name: string;
  score: number;
  weight: number;
  contribution: number;
}

interface HealthResponse {
  score: number;
  grade: Grade;
  factors: HealthFactor[];
  recommendation: string;
}

interface LanguageStat {
  lang: string;
  lines: number;
  pct: number;
}

interface DependencyInfo {
  count: number;
  manager: string | null;
  list: string[];
}

interface MetricsResponse {
  totalFiles: number;
  totalLines: number;
  totalSize: number;
  languages: LanguageStat[];
  extensions: Array<{ ext: string; count: number }>;
  largestFiles: Array<{ file: string; lines: number; size: number }>;
  dependencies: DependencyInfo;
}

type Side = "A" | "B" | "tie";

// ============================================================
// Helpers
// ============================================================

function fmt(n: number): string {
  return n.toLocaleString();
}

// Grade color map — emerald (A/B), amber (C), orange (D), red (F).
// Never indigo or blue.
function gradeColor(grade: Grade): string {
  switch (grade) {
    case "A":
    case "B":
      return "text-emerald-600 dark:text-emerald-400";
    case "C":
      return "text-amber-600 dark:text-amber-400";
    case "D":
      return "text-orange-600 dark:text-orange-400";
    case "F":
    default:
      return "text-red-600 dark:text-red-400";
  }
}

// Pull the per-project success-rate percentage out of the health
// response's factors array.
function successRateOf(h: HealthResponse | null | undefined): number {
  if (!h) return 0;
  const factor = h.factors.find((f) => f.name === "Success Rate");
  return factor?.score ?? 0;
}

function decideWinner(a: number, b: number, higherIsBetter: boolean): Side {
  if (a === b) return "tie";
  const aBetter = higherIsBetter ? a > b : a < b;
  return aBetter ? "A" : "B";
}

// ============================================================
// Hooks (one per Forge endpoint used here)
// ============================================================

function useProjectsList() {
  return useQuery({
    queryKey: ["forge", "projects"],
    queryFn: async () => {
      const r = await fetch("/api/forge/projects");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? `Failed to load projects (${r.status})`,
        );
      }
      return (await r.json()) as ProjectsResponse;
    },
    staleTime: 30_000,
  });
}

function useGlobalStats() {
  return useQuery({
    queryKey: ["forge", "stats"],
    queryFn: async () => {
      const r = await fetch("/api/forge/stats");
      if (!r.ok) return null;
      return (await r.json()) as GlobalStats;
    },
    staleTime: 30_000,
  });
}

function useProjectHealth(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId, "health"],
    queryFn: async () => {
      if (!projectId) return null;
      const r = await fetch(`/api/forge/projects/${projectId}/health`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? `Health check failed (${r.status})`,
        );
      }
      return (await r.json()) as HealthResponse;
    },
    enabled: !!projectId,
    staleTime: 60_000,
    retry: false,
  });
}

function useProjectMetrics(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId, "metrics"],
    queryFn: async () => {
      if (!projectId) return null;
      const r = await fetch(`/api/forge/projects/${projectId}/metrics`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Metrics failed (${r.status})`);
      }
      return (await r.json()) as MetricsResponse;
    },
    enabled: !!projectId,
    staleTime: 60_000,
    retry: false,
  });
}

// ============================================================
// Sub-components
// ============================================================

interface MetricRowProps {
  label: string;
  valueA: ReactNode;
  valueB: ReactNode;
  winner: Side;
}

function MetricRow({ label, valueA, valueB, winner }: MetricRowProps) {
  const aWins = winner === "A";
  const bWins = winner === "B";

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5",
            aWins
              ? "border-emerald-500/40 bg-emerald-500/5"
              : bWins
                ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"
                : "border-border bg-background",
          )}
        >
          <div className="min-w-0 truncate text-sm font-semibold tabular-nums">
            {valueA}
          </div>
          {aWins && (
            <Badge className="shrink-0 bg-emerald-500/15 text-[9px] text-emerald-700 dark:text-emerald-300">
              <Trophy className="size-2.5" />
              Win
            </Badge>
          )}
        </div>
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5",
            bWins
              ? "border-emerald-500/40 bg-emerald-500/5"
              : aWins
                ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"
                : "border-border bg-background",
          )}
        >
          <div className="min-w-0 truncate text-sm font-semibold tabular-nums">
            {valueB}
          </div>
          {bWins && (
            <Badge className="shrink-0 bg-emerald-500/15 text-[9px] text-emerald-700 dark:text-emerald-300">
              <Trophy className="size-2.5" />
              Win
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

interface ComparisonCardProps {
  icon: ReactNode;
  title: string;
  rows: MetricRowProps[];
}

function ComparisonCard({ icon, title, rows }: ComparisonCardProps) {
  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="text-emerald-600 dark:text-emerald-400">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.map((row) => (
          <MetricRow key={row.label} {...row} />
        ))}
      </CardContent>
    </Card>
  );
}

function LoadingValue(): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      Loading…
    </span>
  );
}

function ErrorValue(): ReactNode {
  return (
    <span className="text-xs text-red-600 dark:text-red-400">Failed</span>
  );
}

// ============================================================
// Main component
// ============================================================

export function ProjectComparison() {
  const [projectA, setProjectA] = useState<string>("");
  const [projectB, setProjectB] = useState<string>("");

  const projectsQuery = useProjectsList();
  const statsQuery = useGlobalStats();
  const healthA = useProjectHealth(projectA || null);
  const healthB = useProjectHealth(projectB || null);
  const metricsA = useProjectMetrics(projectA || null);
  const metricsB = useProjectMetrics(projectB || null);

  const projects = projectsQuery.data?.projects ?? [];
  const stats = statsQuery.data ?? null;

  const projectAData = projects.find((p) => p.id === projectA) ?? null;
  const projectBData = projects.find((p) => p.id === projectB) ?? null;

  const bothSelected = !!projectA && !!projectB && projectA !== projectB;

  const handleSwap = () => {
    setProjectA(projectB);
    setProjectB(projectA);
  };

  // --- Per-metric values ---
  const runsA = projectAData?.runCount ?? 0;
  const runsB = projectBData?.runCount ?? 0;
  const runsWinner = decideWinner(runsA, runsB, true);

  const srA = successRateOf(healthA.data);
  const srB = successRateOf(healthB.data);

  const scoreA = healthA.data?.score ?? 0;
  const scoreB = healthB.data?.score ?? 0;

  const filesA = metricsA.data?.totalFiles ?? 0;
  const filesB = metricsB.data?.totalFiles ?? 0;

  const locA = metricsA.data?.totalLines ?? 0;
  const locB = metricsB.data?.totalLines ?? 0;

  const depsA = metricsA.data?.dependencies.count ?? 0;
  const depsB = metricsB.data?.dependencies.count ?? 0;

  const langA = metricsA.data?.languages[0]?.lang ?? "—";
  const langB = metricsB.data?.languages[0]?.lang ?? "—";
  const langMatch = langA === langB;

  // Winners are only declared once both sides have data, so that a
  // still-loading project isn't flagged as the loser.
  const healthReady = !!healthA.data && !!healthB.data;
  const metricsReady = !!metricsA.data && !!metricsB.data;

  const scoreWinner: Side = healthReady
    ? decideWinner(scoreA, scoreB, true)
    : "tie";
  const srWinner: Side = healthReady
    ? decideWinner(srA, srB, true)
    : "tie";
  const filesWinner: Side = metricsReady
    ? decideWinner(filesA, filesB, true)
    : "tie";
  const locWinner: Side = metricsReady
    ? decideWinner(locA, locB, true)
    : "tie";
  // Lower dependency count = leaner = winner.
  const depsWinner: Side = metricsReady
    ? decideWinner(depsA, depsB, false)
    : "tie";

  // Health score cell (big number + grade).
  const renderHealthCell = (h: typeof healthA): ReactNode => {
    if (h.isLoading) return <LoadingValue />;
    if (h.isError || !h.data) return <ErrorValue />;
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-xl font-bold tabular-nums",
            gradeColor(h.data.grade),
          )}
        >
          {fmt(h.data.score)}
        </span>
        <span
          className={cn(
            "text-sm font-semibold",
            gradeColor(h.data.grade),
          )}
        >
          {h.data.grade}
        </span>
        <span className="text-[10px] text-muted-foreground">/100</span>
      </span>
    );
  };

  const renderDepsCell = (
    m: typeof metricsA,
    count: number,
  ): ReactNode => {
    if (m.isLoading) return <LoadingValue />;
    if (m.isError || !m.data) return <ErrorValue />;
    return <span>{fmt(count)}</span>;
  };

  const renderLangCell = (
    m: typeof metricsA,
    lang: string,
  ): ReactNode => {
    if (m.isLoading) return <LoadingValue />;
    if (m.isError || !m.data) return <ErrorValue />;
    return <span>{lang}</span>;
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="size-4 text-emerald-600" />
          Project Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Global stats banner */}
        {stats && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Global Projects
              </div>
              <div className="font-mono text-base font-semibold">
                {fmt(stats.projects)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Global Runs
              </div>
              <div className="font-mono text-base font-semibold">
                {fmt(stats.totalRuns)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Global Success
              </div>
              <div className="font-mono text-base font-semibold text-emerald-600 dark:text-emerald-400">
                {fmt(stats.successRate)}%
              </div>
            </div>
          </div>
        )}

        {/* Selectors */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div className="space-y-1">
            <label
              htmlFor="forge-compare-a"
              className="text-xs font-medium text-muted-foreground"
            >
              Project A
            </label>
            <select
              id="forge-compare-a"
              value={projectA}
              onChange={(e) => setProjectA(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === projectB}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={handleSwap}
            disabled={!projectA || !projectB || projectA === projectB}
            aria-label="Swap projects"
            title="Swap projects"
            className="mb-0.5"
          >
            <GitCompare className="size-4" />
          </Button>
          <div className="space-y-1">
            <label
              htmlFor="forge-compare-b"
              className="text-xs font-medium text-muted-foreground"
            >
              Project B
            </label>
            <select
              id="forge-compare-b"
              value={projectB}
              onChange={(e) => setProjectB(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === projectA}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Projects list loading */}
        {projectsQuery.isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading projects…
          </div>
        )}

        {/* Projects list error */}
        {projectsQuery.isError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {projectsQuery.error instanceof Error
              ? projectsQuery.error.message
              : "Failed to load projects."}
          </div>
        )}

        {/* Empty state */}
        {!projectsQuery.isLoading &&
          !projectsQuery.isError &&
          !bothSelected && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-center">
              <FolderGit2 className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Select two projects above to compare their stats side by side.
              </p>
            </div>
          )}

        {/* Comparison grid */}
        {bothSelected && (
          <div className="space-y-3">
            {/* Project name header row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="truncate rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">A: </span>
                <span className="font-medium">
                  {projectAData?.name ?? projectA}
                </span>
              </div>
              <div className="truncate rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">B: </span>
                <span className="font-medium">
                  {projectBData?.name ?? projectB}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* 1. Health Score */}
              <ComparisonCard
                icon={<Activity className="size-4" />}
                title="Health Score"
                rows={[
                  {
                    label: "Score + Grade",
                    valueA: renderHealthCell(healthA),
                    valueB: renderHealthCell(healthB),
                    winner: scoreWinner,
                  },
                ]}
              />

              {/* 2. Total Runs + Success Rate */}
              <ComparisonCard
                icon={<FolderGit2 className="size-4" />}
                title="Total Runs + Success Rate"
                rows={[
                  {
                    label: "Total Runs",
                    valueA: fmt(runsA),
                    valueB: fmt(runsB),
                    winner: runsWinner,
                  },
                  {
                    label: "Success Rate",
                    valueA: healthA.isLoading ? (
                      <LoadingValue />
                    ) : healthA.isError ? (
                      <ErrorValue />
                    ) : (
                      `${fmt(srA)}%`
                    ),
                    valueB: healthB.isLoading ? (
                      <LoadingValue />
                    ) : healthB.isError ? (
                      <ErrorValue />
                    ) : (
                      `${fmt(srB)}%`
                    ),
                    winner: srWinner,
                  },
                ]}
              />

              {/* 3. File Count + Lines of Code */}
              <ComparisonCard
                icon={<Code2 className="size-4" />}
                title="File Count + Lines of Code"
                rows={[
                  {
                    label: "Files",
                    valueA: metricsA.isLoading ? (
                      <LoadingValue />
                    ) : metricsA.isError ? (
                      <ErrorValue />
                    ) : (
                      fmt(filesA)
                    ),
                    valueB: metricsB.isLoading ? (
                      <LoadingValue />
                    ) : metricsB.isError ? (
                      <ErrorValue />
                    ) : (
                      fmt(filesB)
                    ),
                    winner: filesWinner,
                  },
                  {
                    label: "Lines of Code",
                    valueA: metricsA.isLoading ? (
                      <LoadingValue />
                    ) : metricsA.isError ? (
                      <ErrorValue />
                    ) : (
                      fmt(locA)
                    ),
                    valueB: metricsB.isLoading ? (
                      <LoadingValue />
                    ) : metricsB.isError ? (
                      <ErrorValue />
                    ) : (
                      fmt(locB)
                    ),
                    winner: locWinner,
                  },
                ]}
              />

              {/* 4. Dependencies Count */}
              <ComparisonCard
                icon={<Package className="size-4" />}
                title="Dependencies (lower is leaner)"
                rows={[
                  {
                    label: "Dependency Count",
                    valueA: renderDepsCell(metricsA, depsA),
                    valueB: renderDepsCell(metricsB, depsB),
                    winner: depsWinner,
                  },
                ]}
              />

              {/* 5. Top Language */}
              <ComparisonCard
                icon={<Code2 className="size-4" />}
                title="Top Language"
                rows={[
                  {
                    label: langMatch
                      ? "Same Language"
                      : "Different Languages",
                    valueA: renderLangCell(metricsA, langA),
                    valueB: renderLangCell(metricsB, langB),
                    // Categorical — no winner badge.
                    winner: "tie",
                  },
                ]}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
