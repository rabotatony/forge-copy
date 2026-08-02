"use client";

// ============================================================
// Forge — Experiments Lab
// ============================================================
// A sandboxed page where hard, monitored experiments run on
// Forge itself to discover development breakthroughs. Each
// experiment has a hypothesis, runs in isolation with hard
// timeouts + output caps, and produces a verdict:
//   BREAKTHROUGH → can be promoted to a permanent workflow
//   NO_CHANGE    → ran fine, no breakthrough
//   REGRESSION   → made things worse
//
// Safety rails are enforced in the engine (engine.ts). The UI
// only triggers runs and displays results — it cannot bypass
// the sandbox.
// ============================================================

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Trophy,
  Clock,
  ChevronDown,
  ChevronRight,
  Rocket,
  Shield,
  Brain,
  Swords,
  GitBranch,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loading } from "./ui";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types — mirror the API response shapes
// ---------------------------------------------------------------------------

type Verdict = "BREAKTHROUGH" | "NO_CHANGE" | "REGRESSION";
type Category = "self-improvement" | "tournament" | "synthesis" | "adversarial" | "recursive" | "breakthrough";

interface LatestRun {
  id: string;
  status: string;
  verdict: Verdict | null;
  verdictReason: string | null;
  promoted: boolean;
  startedAt: string;
  completedAt: string | null;
  metrics: string | null;
}

interface ExperimentListItem {
  slug: string;
  name: string;
  category: Category;
  hypothesis: string;
  procedure: string;
  dangerLevel: "safe" | "moderate" | "aggressive";
  dbId: string | null;
  totalRuns: number;
  latestRun: LatestRun | null;
}

interface ExperimentsResponse {
  experiments: ExperimentListItem[];
  stats: { totalExperiments: number; byCategory: Record<string, number> };
  verdictCounts: Record<string, number>;
  promotedCount: number;
}

interface RunDetail {
  run: {
    id: string;
    status: string;
    verdict: Verdict | null;
    verdictReason: string | null;
    promoted: boolean;
    promotedWorkflowId: string | null;
    promotedPresetId: string | null;
    startedAt: string;
    completedAt: string | null;
    metrics: Record<string, number | string | boolean> | null;
    evidence: { summary: string; steps: Array<{ step: string; detail: unknown; t?: number }> } | null;
  };
  experiment: {
    slug: string;
    name: string;
    category: Category;
    hypothesis: string;
    procedure: string;
    dangerLevel: string;
  };
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<Category, { icon: typeof Brain; label: string; color: string; desc: string }> = {
  "self-improvement": {
    icon: TrendingUp,
    label: "Self-Improvement",
    color: "text-emerald-600 dark:text-emerald-400",
    desc: "Can Forge's AI generate a faster version of an existing script?",
  },
  tournament: {
    icon: Swords,
    label: "Tournament",
    color: "text-amber-600 dark:text-amber-400",
    desc: "Generate the same tool in 3 languages, benchmark, pick the winner.",
  },
  synthesis: {
    icon: Sparkles,
    label: "Synthesis",
    color: "text-violet-600 dark:text-violet-400",
    desc: "Fill a capability gap by generating a tool from a description.",
  },
  adversarial: {
    icon: Shield,
    label: "Adversarial",
    color: "text-rose-600 dark:text-rose-400",
    desc: "Generate malformed inputs, find crashes, synthesize a hardened version.",
  },
  recursive: {
    icon: GitBranch,
    label: "Recursive",
    color: "text-sky-600 dark:text-sky-400",
    desc: "Chain AI-generated scripts N levels deep, feed output → input.",
  },
  breakthrough: {
    icon: Sparkles,
    label: "Breakthrough",
    color: "text-emerald-600 dark:text-emerald-400",
    desc: "Promoted breakthroughs that became permanent Forge workflows.",
  },
};

// Defensive fallback so an unknown category string never crashes the UI.
const FALLBACK_CATEGORY_META = {
  icon: Sparkles,
  label: "Experiment",
  color: "text-muted-foreground",
  desc: "",
} as const;

const VERDICT_META: Record<Verdict, { icon: typeof CheckCircle2; label: string; color: string; bg: string }> = {
  BREAKTHROUGH: {
    icon: Trophy,
    label: "Breakthrough",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/10 border-emerald-500/30",
  },
  NO_CHANGE: {
    icon: MinusCircle,
    label: "No change",
    color: "text-muted-foreground",
    bg: "bg-muted/40 border-border",
  },
  REGRESSION: {
    icon: XCircle,
    label: "Regression",
    color: "text-rose-700 dark:text-rose-300",
    bg: "bg-rose-500/10 border-rose-500/30",
  },
};

const DANGER_META: Record<string, { label: string; color: string }> = {
  safe: { label: "Safe", color: "text-emerald-600 dark:text-emerald-400" },
  moderate: { label: "Moderate", color: "text-amber-600 dark:text-amber-400" },
  aggressive: { label: "Aggressive", color: "text-rose-600 dark:text-rose-400" },
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExperimentsLab() {
  const queryClient = useQueryClient();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ExperimentsResponse>({
    queryKey: ["experiments"],
    queryFn: async () => {
      const r = await fetch("/api/forge/experiments");
      if (!r.ok) throw new Error("Failed to load experiments");
      return r.json();
    },
    refetchInterval: 5000,
  });

  const runMutation = useMutation({
    mutationFn: async (slug: string) => {
      const r = await fetch(`/api/forge/experiments/${slug}/run`, { method: "POST" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Run failed");
      }
      return r.json() as Promise<{ runId: string; verdict: Verdict | null; status: string }>;
    },
    onSuccess: (result, slug) => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      setSelectedRunId(result.runId);
      setExpandedSlug(slug);
      if (result.verdict === "BREAKTHROUGH") {
        toast.success("Breakthrough discovered!", {
          description: "The experiment found a real improvement. You can promote it.",
        });
      } else if (result.verdict === "REGRESSION") {
        toast.error("Experiment regressed", {
          description: result.status === "timeout" ? "The experiment timed out." : "See the run details.",
        });
      } else {
        toast.info("Experiment completed", { description: "No breakthrough this time." });
      }
    },
    onError: (err: Error) => {
      toast.error("Experiment failed", { description: err.message });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async (runId: string) => {
      const r = await fetch(`/api/forge/experiments/runs/${runId}?action=promote`, { method: "POST" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Promotion failed");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["experiment-run"] });
      toast.success("Promoted to permanent workflow", {
        description: "The breakthrough is now a reusable Forge workflow + preset.",
      });
    },
    onError: (err: Error) => toast.error("Promotion failed", { description: err.message }),
  });

  const totalRuns = data
    ? data.experiments.reduce((sum, e) => sum + e.totalRuns, 0)
    : 0;
  const breakthroughs = data?.verdictCounts.BREAKTHROUGH ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Experiments Lab</h1>
            <p className="text-sm text-muted-foreground">
              Sandboxed breakthrough discovery — Forge runs hard experiments on itself.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="size-3.5 text-emerald-500" aria-hidden />
          <span>Sandboxed · time-capped · output-limited</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={FlaskConical}
          label="Experiments"
          value={data?.stats.totalExperiments ?? 5}
          color="text-violet-600 dark:text-violet-400"
        />
        <StatCard
          icon={Activity}
          label="Total runs"
          value={totalRuns}
          color="text-sky-600 dark:text-sky-400"
        />
        <StatCard
          icon={Trophy}
          label="Breakthroughs"
          value={breakthroughs}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          icon={Rocket}
          label="Promoted"
          value={data?.promotedCount ?? 0}
          color="text-amber-600 dark:text-amber-400"
        />
      </div>

      {/* Breakthrough rate bar */}
      {data && totalRuns > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <TrendingUp className="size-3.5" aria-hidden />
                Breakthrough rate
              </span>
              <span className="font-mono">
                {breakthroughs}/{totalRuns} runs ({Math.round((breakthroughs / totalRuns) * 100)}%)
              </span>
            </div>
            <Progress
              value={(breakthroughs / totalRuns) * 100}
              className="mt-2 h-2"
            />
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              {(["BREAKTHROUGH", "NO_CHANGE", "REGRESSION"] as Verdict[]).map((v) => (
                <Badge
                  key={v}
                  variant="outline"
                  className={cn("gap-1 font-mono", VERDICT_META[v].color)}
                >
                  {VERDICT_META[v].label}: {data.verdictCounts[v] ?? 0}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Experiment cards */}
      <div className="space-y-3">
        {isLoading ? (
          <Card>
            <CardContent>
              <Loading label="Loading experiments…" />
            </CardContent>
          </Card>
        ) : (
          data?.experiments.map((exp) => {
            const meta = CATEGORY_META[exp.category] ?? FALLBACK_CATEGORY_META;
            const Icon = meta.icon;
            const isExpanded = expandedSlug === exp.slug;
            const isRunning = runMutation.isPending && runMutation.variables === exp.slug;
            const latest = exp.latestRun;
            const verdict = latest?.verdict;
            const vMeta = verdict ? VERDICT_META[verdict] : null;
            const danger = DANGER_META[exp.dangerLevel];

            return (
              <Card key={exp.slug} className={cn("overflow-hidden transition-shadow", isExpanded && "shadow-md")}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted", meta.color)}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                          <span className="truncate">{exp.name}</span>
                          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                            <Icon className="size-2.5" aria-hidden />
                            {meta.label}
                          </Badge>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={cn("gap-1 text-[10px] font-normal", danger.color)}>
                                <AlertTriangle className="size-2.5" aria-hidden />
                                {danger.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Danger level: {exp.dangerLevel}</TooltipContent>
                          </Tooltip>
                        </CardTitle>
                        <CardDescription className="mt-1 line-clamp-2 text-xs">
                          {exp.hypothesis}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isRunning}
                        onClick={() => runMutation.mutate(exp.slug)}
                        className="gap-1.5"
                      >
                        {isRunning ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Play className="size-3.5" aria-hidden />
                        )}
                        {isRunning ? "Running" : "Run"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedSlug(isExpanded ? null : exp.slug)}
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {/* Latest verdict strip */}
                {latest && (
                  <CardContent className="pb-3 pt-0">
                    <div className={cn("flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs", vMeta?.bg ?? "bg-muted/30 border-border")}>
                      {verdict && (
                        <span className={cn("flex items-center gap-1 font-medium", vMeta?.color)}>
                          {(() => {
                            const VIcon = vMeta!.icon;
                            return <VIcon className="size-3.5" aria-hidden />;
                          })()}
                          {vMeta?.label}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {latest.verdictReason ?? `Status: ${latest.status}`}
                      </span>
                      <span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                        {latest.promoted && (
                          <Badge variant="outline" className="gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                            <Rocket className="size-2.5" aria-hidden />
                            Promoted
                          </Badge>
                        )}
                        <Clock className="size-3" aria-hidden />
                        {new Date(latest.startedAt).toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                )}

                {/* Expanded: procedure + runs */}
                {isExpanded && (
                  <CardContent className="border-t border-border pt-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Procedure
                        </h4>
                        <p className="text-xs leading-relaxed text-foreground/90">{exp.procedure}</p>
                      </div>
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Recent runs
                        </h4>
                        <RecentRunsList slug={exp.slug} onSelect={setSelectedRunId} selectedRunId={selectedRunId} />
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Run detail drawer (inline panel) */}
      {selectedRunId && (
        <RunDetailPanel
          runId={selectedRunId}
          onClose={() => setSelectedRunId(null)}
          onPromote={(id) => promoteMutation.mutate(id)}
          promoting={promoteMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Brain; label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <span className={cn("flex size-8 items-center justify-center rounded-md bg-muted", color)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight tabular-nums">{value}</div>
          <div className="truncate text-[11px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent runs list (fetches on expand)
// ---------------------------------------------------------------------------

function RecentRunsList({ slug, onSelect, selectedRunId }: { slug: string; onSelect: (id: string) => void; selectedRunId: string | null }) {
  const { data, isLoading } = useQuery<{ runs: LatestRun[] }>({
    queryKey: ["experiment-runs", slug],
    queryFn: async () => {
      const r = await fetch(`/api/forge/experiments?slug=${slug}`);
      if (!r.ok) throw new Error("Failed to load runs");
      return r.json();
    },
    refetchInterval: 4000,
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Loading runs…</div>;
  }
  const runs = data?.runs ?? [];
  if (runs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        No runs yet. Click <span className="font-medium text-foreground">Run</span> to start this experiment.
      </div>
    );
  }
  return (
    <ScrollArea className="max-h-64">
      <div className="space-y-1.5 pr-2">
        {runs.map((run) => {
          const vMeta = run.verdict ? VERDICT_META[run.verdict] : null;
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelect(run.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                selectedRunId === run.id ? "border-primary/40 bg-accent" : "border-border",
              )}
            >
              {run.verdict ? (
                <span className={cn("flex size-4 shrink-0 items-center justify-center", vMeta?.color)}>
                  {(() => {
                    const VIcon = vMeta!.icon;
                    return <VIcon className="size-3.5" aria-hidden />;
                  })()}
                </span>
              ) : (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {new Date(run.startedAt).toLocaleTimeString()}
              </span>
              {run.promoted && (
                <Rocket className="size-3 shrink-0 text-emerald-500" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Run detail panel
// ---------------------------------------------------------------------------

function RunDetailPanel({
  runId,
  onClose,
  onPromote,
  promoting,
}: {
  runId: string;
  onClose: () => void;
  onPromote: (id: string) => void;
  promoting: boolean;
}) {
  const { data, isLoading } = useQuery<RunDetail>({
    queryKey: ["experiment-run", runId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/experiments/runs/${runId}`);
      if (!r.ok) throw new Error("Failed to load run");
      return r.json();
    },
    refetchInterval: 3000,
  });

  const run = data?.run;
  const exp = data?.experiment;
  const verdict = run?.verdict;
  const vMeta = verdict ? VERDICT_META[verdict] : null;
  const canPromote = verdict === "BREAKTHROUGH" && !run?.promoted;

  return (
    <Card className="border-primary/30 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {verdict && vMeta ? (
              <span className={cn("flex size-8 items-center justify-center rounded-md", vMeta.bg, vMeta.color)}>
                {(() => {
                  const VIcon = vMeta.icon;
                  return <VIcon className="size-4" aria-hidden />;
                })()}
              </span>
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            )}
            <div>
              <CardTitle className="text-base">{exp?.name ?? "Run detail"}</CardTitle>
              <CardDescription className="font-mono text-[10px]">{runId}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canPromote && (
              <Button
                size="sm"
                onClick={() => onPromote(runId)}
                disabled={promoting}
                className="gap-1.5"
              >
                {promoting ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
                Promote
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading run…
          </div>
        ) : (
          <>
            {run?.verdictReason && (
              <div className={cn("rounded-md border px-3 py-2 text-sm", vMeta?.bg ?? "bg-muted/30 border-border")}>
                <span className={cn("font-medium", vMeta?.color)}>{vMeta?.label}: </span>
                <span className="text-foreground/90">{run.verdictReason}</span>
              </div>
            )}

            {/* Metrics */}
            {run?.metrics && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Metrics
                </h4>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(run.metrics).map(([k, v]) => (
                    <div key={k} className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                      <div className="truncate text-[10px] text-muted-foreground">{k}</div>
                      <div className="font-mono text-sm font-medium tabular-nums">{String(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            {run?.evidence?.summary && (
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Summary
                </h4>
                <p className="text-sm text-foreground/90">{run.evidence.summary}</p>
              </div>
            )}

            {/* Procedure trace */}
            {run?.evidence?.steps && run.evidence.steps.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Procedure trace ({run.evidence.steps.length} events)
                </h4>
                <ScrollArea className="max-h-72 rounded-md border border-border">
                  <div className="divide-y divide-border font-mono text-[11px]">
                    {run.evidence.steps.map((s, i) => (
                      <div key={i} className="flex gap-2 px-2.5 py-1.5">
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {String(i + 1).padStart(3, "0")}
                        </span>
                        <span className="shrink-0 font-medium text-foreground">{s.step}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {run?.promoted && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                <Rocket className="size-3.5" aria-hidden />
                <span>Promoted to a permanent Forge workflow + preset.</span>
                {run.promotedWorkflowId && (
                  <span className="ml-auto font-mono text-[10px] opacity-70">{run.promotedWorkflowId.slice(-8)}</span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
