"use client";

import { useState } from "react";
import { GitCompare, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { formatDuration, formatRelativeTime } from "./format";

interface RunCompare {
  runA: { id: string; workflow: string; status: string; durationMs: number; startedAt: string };
  runB: { id: string; workflow: string; status: string; durationMs: number; startedAt: string };
}

/**
 * RunComparison — side-by-side comparison of two runs.
 * Shows duration diff, status diff, and which run was faster.
 * GitHub Actions can't do this — Forge can.
 */
export function RunComparison({ projectId }: { projectId: string }) {
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);

  const { data: runs } = useQuery({
    queryKey: ["forge", "projects", projectId, "runs"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}`);
      const d = await r.json();
      return d.recentRuns as Array<{ id: string; workflow: string; status: string; durationMs: number | null; startedAt: string }>;
    },
  });

  const { data: comparison, isLoading: comparing } = useQuery({
    queryKey: ["forge", "compare", selectedA, selectedB],
    queryFn: async () => {
      if (!selectedA || !selectedB) return null;
      const r = await fetch(`/api/forge/projects/${projectId}/analytics/compare?runA=${selectedA}&runB=${selectedB}`);
      const d = await r.json();
      return d.comparison as RunCompare;
    },
    enabled: !!selectedA && !!selectedB,
  });

  const recentRuns = runs ?? [];

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="size-4 text-emerald-600" />
          Run Comparison
        </CardTitle>
        <CardDescription>
          Compare two runs side-by-side — duration, status, and performance diff.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recentRuns.length < 2 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Need at least 2 runs to compare.
          </p>
        ) : (
          <>
            {/* Selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Run A</Label>
                <select
                  value={selectedA ?? ""}
                  onChange={(e) => setSelectedA(e.target.value || null)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="">Select run…</option>
                  {recentRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.workflow} · {formatRelativeTime(r.startedAt)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Run B</Label>
                <select
                  value={selectedB ?? ""}
                  onChange={(e) => setSelectedB(e.target.value || null)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="">Select run…</option>
                  {recentRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.workflow} · {formatRelativeTime(r.startedAt)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Comparison results */}
            {comparing && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Comparing…
              </div>
            )}

            {comparison && !comparing && (
              <div className="space-y-3">
                {/* Side-by-side cards */}
                <div className="grid grid-cols-2 gap-3">
                  <RunCard label="Run A" data={comparison.runA} />
                  <RunCard label="Run B" data={comparison.runB} />
                </div>

                {/* Diff summary */}
                <DiffSummary runA={comparison.runA} runB={comparison.runB} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("font-medium text-muted-foreground", className)}>{children}</span>;
}

function RunCard({ label, data }: { label: string; data: RunCompare["runA"] }) {
  const isSuccess = data.status === "success";
  const isFailed = data.status === "failed";
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-[10px]">{label}</Badge>
        {isSuccess ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : isFailed ? (
          <XCircle className="size-4 text-red-600" />
        ) : (
          <Clock className="size-4 text-amber-600" />
        )}
      </div>
      <div className="text-sm font-mono font-medium">{data.workflow}</div>
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <div>Status: <span className={isSuccess ? "text-emerald-600" : isFailed ? "text-red-600" : ""}>{data.status}</span></div>
        <div>Duration: <span className="font-mono text-foreground">{formatDuration(data.durationMs)}</span></div>
        <div>Started: {formatRelativeTime(data.startedAt)}</div>
      </div>
    </div>
  );
}

function DiffSummary({ runA, runB }: { runA: RunCompare["runA"]; runB: RunCompare["runB"] }) {
  const durationDiff = runB.durationMs - runA.durationMs;
  const isFaster = durationDiff < 0;
  const isSame = durationDiff === 0;
  const pctChange = runA.durationMs > 0 ? Math.round((durationDiff / runA.durationMs) * 100) : 0;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Diff Summary
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Status change:</span>{" "}
          {runA.status === runB.status ? (
            <Badge variant="outline" className="text-[10px]">same</Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300">
              {runA.status} → {runB.status}
            </Badge>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Duration:</span>{" "}
          {isSame ? (
            <Badge variant="outline" className="text-[10px]">no change</Badge>
          ) : (
            <Badge
              className={cn(
                "text-[10px]",
                isFaster
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-red-500/15 text-red-700 dark:text-red-300",
              )}
            >
              {isFaster ? "⚡" : "🐢"} {isFaster ? "" : "+"}{formatDuration(Math.abs(durationDiff))} ({isFaster ? "" : "+"}{pctChange}%)
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
