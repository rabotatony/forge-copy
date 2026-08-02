"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, GitBranch, Play, XCircle, CheckCircle, Clock, Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/forge/status-badge";
import { formatRelativeTime, formatDuration } from "@/components/forge/format";

interface PipelineRunData {
  pipelineRun: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    trigger: string;
  };
  stageRuns: Array<{
    id: string;
    stageId: string;
    stageName: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    matrixValues: string | null;
    runIds: string;
    error: string | null;
  }>;
  runs: Array<{
    id: string;
    workflow: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    exitCode: number | null;
    durationMs: number | null;
    label: string | null;
    matrixValues: string | null;
  }>;
}

export function PipelineRunView({
  pipelineRunId,
  onBack,
  onOpenRun,
}: {
  pipelineRunId: string;
  onBack: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const [data, setData] = useState<PipelineRunData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    const fetch_ = async () => {
      try {
        const r = await fetch(`/api/forge/pipelines/runs/${pipelineRunId}`);
        if (!r.ok) throw new Error("Failed to load");
        const d = await r.json();
        if (!closed) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (!closed) setError(e instanceof Error ? e.message : "Failed");
      }
    };
    fetch_();
    const interval = setInterval(fetch_, 2000);
    return () => { closed = true; clearInterval(interval); };
  }, [pipelineRunId]);

  if (error) return <Card><CardContent className="py-10 text-center text-red-600">{error}</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-10 text-center text-muted-foreground">Loading pipeline run…</CardContent></Card>;

  const pr = data.pipelineRun;
  const isRunning = pr.status === "running";

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2" aria-label="Back to pipelines">
          <ArrowLeft className="size-4" aria-hidden /> Back to pipelines
        </Button>
      </div>

      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <GitBranch className="size-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Pipeline Run</h1>
            <p className="font-mono text-sm text-muted-foreground">{pr.id.slice(0, 12)}…</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={pr.status as "queued" | "running" | "success" | "failed" | "canceled" | "waiting_approval"} />
              <Badge variant="outline">{pr.trigger}</Badge>
              <span className="text-xs text-muted-foreground">started {formatRelativeTime(pr.startedAt)}</span>
              {pr.finishedAt && (
                <span className="text-xs text-muted-foreground">
                  · {formatDuration(new Date(pr.finishedAt).getTime() - new Date(pr.startedAt).getTime())}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Stage DAG */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-5" />
            Stages
            <span className="text-sm font-normal text-muted-foreground">
              ({data.stageRuns.length})
            </span>
            {isRunning && <Loader2 className="size-4 animate-spin text-amber-600" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {data.stageRuns.map((stage, i) => (
              <div key={stage.id} className="flex items-center gap-3">
                <StageCard stage={stage} runs={data.runs} onOpenRun={onOpenRun} />
                {i < data.stageRuns.length - 1 && (
                  <div className="text-muted-foreground" aria-hidden>→</div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Run list */}
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {data.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2">
              {data.runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onOpenRun(r.id)}
                  className="flex w-full items-center justify-between rounded-md border p-2 text-left hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status as "queued" | "running" | "success" | "failed" | "canceled" | "waiting_approval"} />
                    <span className="font-mono text-sm">{r.workflow}</span>
                    {r.label && <Badge variant="outline">{r.label}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {r.durationMs !== null && <span>{formatDuration(r.durationMs)}</span>}
                    <span>{formatRelativeTime(r.startedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function StageCard({
  stage,
  runs,
  onOpenRun,
}: {
  stage: PipelineRunData["stageRuns"][0];
  runs: PipelineRunData["runs"];
  onOpenRun: (runId: string) => void;
}) {
  let runIds: string[] = [];
  try { runIds = JSON.parse(stage.runIds) as string[]; } catch { /* ignore */ }
  const stageRuns = runs.filter(r => runIds.includes(r.id));
  const statusIcon = () => {
    switch (stage.status) {
      case "success": return <CheckCircle className="size-5 text-emerald-600" />;
      case "failed": return <XCircle className="size-5 text-red-600" />;
      case "running": return <Loader2 className="size-5 text-amber-600 animate-spin" />;
      case "pending":
      case "blocked": return <Clock className="size-5 text-muted-foreground" />;
      case "skipped": return <div className="size-5 rounded-full border-2 border-muted-foreground" />;
      default: return <Clock className="size-5 text-muted-foreground" />;
    }
  };

  return (
    <div className={`min-w-[180px] rounded-lg border p-3 ${stage.status === "running" ? "border-amber-500/40 bg-amber-500/5" : stage.status === "success" ? "border-emerald-500/30" : stage.status === "failed" ? "border-red-500/40 bg-red-500/5" : ""}`}>
      <div className="flex items-center gap-2 mb-2">
        {statusIcon()}
        <span className="font-medium text-sm">{stage.stageName}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">{stage.status}</Badge>
        {stageRuns.length > 0 && (
          <span className="text-xs text-muted-foreground">{stageRuns.length} run{stageRuns.length > 1 ? "s" : ""}</span>
        )}
      </div>
      {stage.startedAt && (
        <p className="text-xs text-muted-foreground mt-1">
          {stage.finishedAt
            ? formatDuration(new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime())
            : "running…"}
        </p>
      )}
      {stageRuns.length > 0 && (
        <div className="mt-2 space-y-1">
          {stageRuns.map(r => (
            <button
              key={r.id}
              onClick={() => onOpenRun(r.id)}
              className="block w-full text-left text-xs font-mono text-muted-foreground hover:text-foreground truncate"
            >
              → {r.id.slice(0, 8)}… ({r.status})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
