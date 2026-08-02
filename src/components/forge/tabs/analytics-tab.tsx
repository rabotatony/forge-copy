"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, TrendingUp, AlertTriangle, Clock, CheckCircle, XCircle } from "lucide-react";
import { useAnalyticsOverview, usePerformanceTrends, useFailurePatterns } from "@/components/forge/use-forge-api";
import { formatRelativeTime, formatDuration } from "@/components/forge/format";
import { StatusBadge } from "@/components/forge/status-badge";

export function AnalyticsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useAnalyticsOverview(projectId);
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const { data: trends } = usePerformanceTrends(projectId, selectedWorkflow || "inspect");
  const { data: failures } = useFailurePatterns(projectId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading analytics...</p>;
  if (!data) return null;

  const successPct = Math.round(data.successRate * 100);

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.totalRuns}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-flex flex items-center gap-1"><CheckCircle className="size-3.5 text-emerald-600" />Success Rate</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{successPct}%</div>
            <Progress value={successPct} className="mt-1 h-1.5" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Clock className="size-3.5" />Avg Duration</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatDuration(data.avgDurationMs)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Activity className="size-3.5 text-amber-600" />Active Runs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.activeRuns}</div></CardContent>
        </Card>
      </div>

      {/* Runs by status */}
      <Card>
        <CardHeader><CardTitle>Runs by Status</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.runsByStatus).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 rounded-md border p-2">
                <StatusBadge status={status as "queued" | "running" | "success" | "failed" | "canceled" | "waiting_approval"} />
                <span className="font-mono text-sm font-bold">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Runs by workflow */}
      <Card>
        <CardHeader><CardTitle>Runs by Workflow</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-2">
            {data.runsByWorkflow.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> :
             data.runsByWorkflow.map((w) => (
              <div key={w.workflow} className="flex items-center justify-between rounded-md border p-2">
                <span className="font-mono text-sm">{w.workflow}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{w.count} runs</span>
                  <div className="w-24">
                    <Progress value={w.successRate * 100} className="h-1.5" />
                  </div>
                  <span className="font-mono text-xs w-10 text-right">{Math.round(w.successRate * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Performance trends */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="size-5" />Performance Trends</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Select workflow" /></SelectTrigger>
            <SelectContent>
              {data.runsByWorkflow.map((w) => (
                <SelectItem key={w.workflow} value={w.workflow}>{w.workflow}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {trends && trends.trends.length > 0 ? (
            <TrendChart trends={trends.trends} />
          ) : (
            <p className="text-sm text-muted-foreground">No trend data for this workflow.</p>
          )}
        </CardContent>
      </Card>

      {/* Failure patterns */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-red-600" />Failure Patterns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2">
            {(!failures?.patterns || failures.patterns.length === 0) ? <p className="text-sm text-muted-foreground">No failure data yet.</p> :
             failures.patterns.filter(p => p.failedRuns > 0).map((p) => (
              <div key={p.workflow} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium">{p.workflow}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.failureRate > 0.5 ? "destructive" : "secondary"}>
                      {p.failedRuns}/{p.totalRuns} failed
                    </Badge>
                    <span className="font-mono text-xs">{Math.round(p.failureRate * 100)}%</span>
                  </div>
                </div>
                {p.sampleErrors.length > 0 && (
                  <div className="space-y-1">
                    {p.sampleErrors.slice(0, 3).map((err, i) => (
                      <code key={i} className="block text-xs bg-red-500/5 text-red-700 dark:text-red-400 p-1.5 rounded font-mono truncate">{err}</code>
                    ))}
                  </div>
                )}
                {p.lastFailedAt && <p className="text-xs text-muted-foreground">Last failed {formatRelativeTime(p.lastFailedAt)}</p>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader><CardTitle>Recent Runs</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-2">
            {data.recentRuns.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> :
             data.recentRuns.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status as "queued" | "running" | "success" | "failed" | "canceled" | "waiting_approval"} />
                  <span className="font-mono text-sm">{r.workflow}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {r.durationMs !== null && <span>{formatDuration(r.durationMs)}</span>}
                  <span>{formatRelativeTime(r.startedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TrendChart({ trends }: { trends: Array<{ runId: string; startedAt: string; durationMs: number | null; status: string }> }) {
  const points = trends.filter(t => t.durationMs !== null);
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No duration data.</p>;
  const maxDur = Math.max(...points.map(p => p.durationMs!));
  const w = 600;
  const h = 150;
  const pad = 20;
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const path = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (p.durationMs! / maxDur) * (h - pad * 2);
    return `${i === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} className="stroke-border" strokeWidth="1" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} className="stroke-border" strokeWidth="1" />
        <path d={path} fill="none" className="stroke-emerald-600" strokeWidth="2" />
        {points.map((p, i) => {
          const x = pad + i * stepX;
          const y = h - pad - (p.durationMs! / maxDur) * (h - pad * 2);
          return <circle key={i} cx={x} cy={y} r="3" className={p.status === "success" ? "fill-emerald-600" : "fill-red-600"} />;
        })}
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatRelativeTime(points[0]!.startedAt)}</span>
        <span>max: {formatDuration(maxDur)}</span>
        <span>{formatRelativeTime(points[points.length - 1]!.startedAt)}</span>
      </div>
    </div>
  );
}
