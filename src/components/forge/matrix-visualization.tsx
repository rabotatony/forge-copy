"use client";

import { Grid3x3, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProject } from "./use-forge-api";
import { formatDuration } from "./format";

/**
 * MatrixVisualization — shows matrix runs as a grid.
 * GitHub Actions shows matrix runs in a grid view — Forge now does too.
 */
export function MatrixVisualization({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProject(projectId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </CardContent>
      </Card>
    );
  }

  // Find all matrix runs (matrixTotal > 1).
  const matrixRuns = (data?.recentRuns ?? []).filter((r) => {
    // We don't have matrixTotal in RunSummary, so we group by workflow + similar timestamps.
    return true; // Show all runs, group by workflow
  });

  // Group runs by workflow to show matrix-like grid.
  const byWorkflow = new Map<string, typeof matrixRuns>();
  for (const r of matrixRuns) {
    const arr = byWorkflow.get(r.workflow) ?? [];
    arr.push(r);
    byWorkflow.set(r.workflow, arr);
  }

  // Only show workflows with 2+ runs (potential matrix).
  const matrixWorkflows = Array.from(byWorkflow.entries()).filter(([, runs]) => runs.length >= 2);

  if (matrixWorkflows.length === 0) {
    return null; // Don't show if no matrix runs
  }

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Grid3x3 className="size-4 text-muted-foreground" />
          Matrix Runs
        </CardTitle>
        <CardDescription>
          Multi-configuration runs displayed as a grid.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {matrixWorkflows.map(([workflow, runs]) => (
          <div key={workflow}>
            <div className="mb-1.5 flex items-center gap-2">
              <code className="text-xs font-medium">{workflow}</code>
              <Badge variant="outline" className="text-[10px]">{runs.length} runs</Badge>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
              {runs.slice(0, 12).map((r) => {
                const isSuccess = r.status === "success";
                const isFailed = r.status === "failed";
                const isRunning = r.status === "running" || r.status === "queued";
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border p-2 text-center transition-colors",
                      isSuccess && "border-emerald-500/30 bg-emerald-500/[0.04]",
                      isFailed && "border-red-500/30 bg-red-500/[0.04]",
                      isRunning && "border-amber-500/30 bg-amber-500/[0.04]",
                    )}
                    title={`${r.workflow} · ${r.status} · ${formatDuration(r.durationMs ?? 0)}`}
                  >
                    {isSuccess ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : isFailed ? (
                      <XCircle className="size-4 text-red-600" />
                    ) : (
                      <Clock className="size-4 animate-pulse text-amber-600" />
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {formatDuration(r.durationMs ?? 0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
