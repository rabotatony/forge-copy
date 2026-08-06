"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertCircle, Shield, Code, Gauge, Rocket, Lightbulb,
  ChevronRight, Loader2, CheckCircle2, XCircle, Clock, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useStartRun } from "./use-forge-api";
import { toast } from "sonner";

type InsightCategory = "critical" | "security" | "quality" | "performance" | "readiness" | "opportunity";
type InsightPriority = "critical" | "high" | "medium" | "low";

interface Insight {
  id: string; category: InsightCategory; priority: InsightPriority;
  title: string; description: string; action: string;
  workflow?: string; effort: "quick" | "medium" | "large";
  value: "low" | "medium" | "high" | "critical";
  evidence?: string[]; done?: boolean;
}

interface ProjectAnalysis {
  projectId: string; analyzedAt: string;
  metrics: {
    fileCount: number; totalBytes: number; dependencyCount: number;
    hasTests: boolean; hasLinting: boolean; hasCI: boolean; hasDockerfile: boolean;
    hasReadme: boolean; hasGitignore: boolean; hasLicense: boolean;
    buildScriptExists: boolean; testScriptExists: boolean;
    framework: string | null; language: string | null;
  };
  insights: Insight[];
  healthScore: number;
}

const CATEGORY_META: Record<InsightCategory, { icon: typeof Shield; label: string; color: string; bg: string }> = {
  critical: { icon: AlertCircle, label: "Critical", color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10" },
  security: { icon: Shield, label: "Security", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
  quality: { icon: Code, label: "Quality", color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500/10" },
  performance: { icon: Gauge, label: "Performance", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
  readiness: { icon: Rocket, label: "Readiness", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  opportunity: { icon: Lightbulb, label: "Opportunity", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
};

const PRIORITY_META: Record<InsightPriority, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
  high: { label: "High", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  medium: { label: "Medium", className: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  low: { label: "Low", className: "bg-muted text-muted-foreground border-border" },
};

export function InsightsPanel({ projectId, onRunStarted }: { projectId: string; onRunStarted?: (runId: string) => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "insights", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/insights`);
      if (!r.ok) throw new Error("Failed to load insights");
      return r.json() as Promise<ProjectAnalysis>;
    },
  });

  const [expanded, setExpanded] = useState(false);

  if (isLoading) return <Card><CardContent className="flex items-center justify-center py-12"><Loader2 className="mr-2 size-5 animate-spin text-emerald-600" /><span className="text-sm text-muted-foreground">Analyzing project…</span></CardContent></Card>;
  if (isError || !data) return <Card><CardContent className="py-8 text-center text-sm text-red-600 dark:text-red-400">Failed to analyze project: {error?.message}</CardContent></Card>;

  const criticalCount = (data.insights ?? []).filter(i => i.priority === "critical").length;
  const highCount = (data.insights ?? []).filter(i => i.priority === "high").length;
  const visibleInsights = expanded ? data.insights : (data.insights ?? []).slice(0, 4);
  const hiddenCount = (data.insights ?? []).length - 4;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-1">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4 text-emerald-600" />Project Health</CardTitle>
              <CardDescription>Deep analysis with {(data.insights ?? []).length} actionable recommendations</CardDescription>
            </div>
            <HealthScoreBadge score={data.healthScore} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricChip icon={CheckCircle2} label="Tests" ok={data.metrics.hasTests} />
            <MetricChip icon={Code} label="Linting" ok={data.metrics.hasLinting} />
            <MetricChip icon={Rocket} label="CI/CD" ok={data.metrics.hasCI} />
            <MetricChip icon={Shield} label="Docker" ok={data.metrics.hasDockerfile} />
            <MetricChip icon={Code} label="README" ok={data.metrics.hasReadme} />
            <MetricChip icon={Shield} label=".gitignore" ok={data.metrics.hasGitignore} />
            <MetricChip icon={Shield} label="License" ok={data.metrics.hasLicense} />
            <MetricChip icon={Code} label="Framework" value={data.metrics.framework ?? "—"} />
          </div>
          {(criticalCount > 0 || highCount > 0) && (
            <div className="mt-4 flex items-center gap-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
              {criticalCount > 0 && <div className="flex items-center gap-1.5 text-sm"><AlertCircle className="size-4 text-rose-500" /><span className="font-medium text-rose-700 dark:text-rose-300">{criticalCount} critical</span></div>}
              {highCount > 0 && <div className="flex items-center gap-1.5 text-sm"><AlertCircle className="size-4 text-amber-500" /><span className="font-medium text-amber-700 dark:text-amber-300">{highCount} high priority</span></div>}
              <span className="text-xs text-muted-foreground">Fix these first to maximize project health</span>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="space-y-3">
        {visibleInsights.map(insight => <InsightCard key={insight.id} insight={insight} projectId={projectId} onRunStarted={onRunStarted} />)}
        {hiddenCount > 0 && !expanded && (
          <button type="button" onClick={() => setExpanded(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-foreground">
            <ChevronRight className="size-3.5 rotate-90" />Show {hiddenCount} more recommendations
          </button>
        )}
        {expanded && hiddenCount > 0 && (
          <button type="button" onClick={() => setExpanded(false)} className="w-full rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent">Show less</button>
        )}
      </div>
    </div>
  );
}

function HealthScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : score >= 50 ? "text-amber-600 dark:text-amber-400 bg-amber-500/10" : "text-rose-600 dark:text-rose-400 bg-rose-500/10";
  return <div className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5", color)}><Gauge className="size-5" /><div><div className="text-xl font-bold leading-none">{score}</div><div className="text-[10px] uppercase tracking-wide opacity-80">/ 100</div></div></div>;
}

function MetricChip({ icon: Icon, label, ok, value }: { icon: typeof Code; label: string; ok?: boolean; value?: string }) {
  if (value !== undefined) return <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2"><Icon className="size-3.5 text-muted-foreground" /><div className="min-w-0"><div className="truncate text-xs font-medium">{value}</div><div className="text-[10px] text-muted-foreground">{label}</div></div></div>;
  return <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card/50")}>{ok ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <XCircle className="size-3.5 text-muted-foreground" />}<div><div className="text-xs font-medium">{label}</div><div className={cn("text-[10px]", ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{ok ? "Yes" : "No"}</div></div></div>;
}

function InsightCard({ insight, projectId, onRunStarted }: { insight: Insight; projectId: string; onRunStarted?: (runId: string) => void }) {
  const startRun = useStartRun();
  const meta = CATEGORY_META[insight.category];
  const priorityMeta = PRIORITY_META[insight.priority];
  const Icon = meta.icon;

  const handleRun = async () => {
    if (!insight.workflow) return;
    try { const result = await startRun.mutateAsync({ projectId, workflow: insight.workflow }); toast.success(`Started ${insight.workflow} workflow`); onRunStarted?.(result.runId); }
    catch (e) { toast.error(e instanceof Error ? e.message : `Failed to start ${insight.workflow}`); }
  };

  return (
    <Card className={cn("transition-shadow", insight.done ? "opacity-60" : "hover:shadow-md")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", insight.done ? "bg-emerald-500/10" : meta.bg)}>
            {insight.done ? <CheckCircle2 className="size-4.5 text-emerald-600" /> : <Icon className={cn("size-4.5", meta.color)} />}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={cn("text-sm font-semibold", insight.done && "line-through")}>{insight.title}</h4>
              {insight.done ? <Badge variant="outline" className="text-[10px] font-medium text-emerald-600 border-emerald-500/30">✓ Done</Badge> : <Badge variant="outline" className={cn("text-[10px] font-medium", priorityMeta.className)}>{priorityMeta.label}</Badge>}
              <Badge variant="secondary" className="text-[10px] font-normal">{meta.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{insight.description}</p>
            {insight.evidence && insight.evidence.length > 0 && <div className="flex flex-wrap gap-1">{insight.evidence.map((ev, i) => <code key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{ev}</code>)}</div>}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="size-3" />{insight.effort === "quick" ? "< 5 min" : insight.effort === "medium" ? "< 1 hour" : "> 1 hour"}</div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Zap className="size-3" />{insight.value} value</div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-xs">{insight.done ? <span className="text-emerald-600 dark:text-emerald-400">✓ Completed — {insight.action}</span> : <><span className="font-medium text-foreground">Next step: </span><span className="text-muted-foreground">{insight.action}</span></>}</p>
              {insight.workflow && !insight.done && <Button size="sm" className="shrink-0 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" disabled={startRun.isPending} onClick={handleRun}>{startRun.isPending && startRun.variables?.workflow === insight.workflow ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className="size-3.5" />}Run</Button>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
