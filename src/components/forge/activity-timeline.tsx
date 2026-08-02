"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Play, Bot, ScrollText, Clock, Zap, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loading } from "./ui";
import { cn } from "@/lib/utils";

interface ActivityItem { id: string; type: "run" | "audit"; title: string; subtitle: string; status?: string; timestamp: string; durationMs?: number | null; runId?: string; trigger?: string; icon: string }
interface ActivityResponse { projectId: string; projectName: string; timeline: ActivityItem[]; total: number }

const ICON_MAP: Record<string, typeof CheckCircle2> = { CheckCircle2, XCircle, Play, Bot, ScrollText };
const STATUS_COLORS: Record<string, string> = { success: "text-emerald-600 dark:text-emerald-400", failed: "text-rose-600 dark:text-rose-400", running: "text-amber-600 dark:text-amber-400", canceled: "text-muted-foreground", queued: "text-amber-600 dark:text-amber-400", waiting_approval: "text-amber-600 dark:text-amber-400" };
const TRIGGER_LABELS: Record<string, string> = { manual: "Manual", auto: "Auto-run", cron: "Scheduled", webhook: "Webhook", pipeline: "Pipeline" };

export function ActivityTimeline({ projectId, onOpenRun }: { projectId: string; onOpenRun?: (runId: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["forge", "activity", projectId],
    queryFn: async () => { const r = await fetch(`/api/forge/projects/${projectId}/activity`); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<ActivityResponse> },
    refetchInterval: 10_000,
  });

  const [filter, setFilter] = useState<"all" | "success" | "failed" | "agent">("all");
  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.timeline;
    if (filter === "agent") return data.timeline.filter(t => t.trigger === "auto");
    return data.timeline.filter(t => t.status === filter);
  }, [data, filter]);

  if (isLoading || !data) return <Loading label="Loading activity…" />;
  if (data.timeline.length === 0) return <Card className="border-dashed"><CardContent className="flex flex-col items-center justify-center gap-3 py-12"><div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10"><Activity className="size-6 text-emerald-600" /></div><div className="text-center"><p className="text-sm font-medium">No activity yet</p><p className="mt-1 text-xs text-muted-foreground">Run a workflow to see activity here.</p></div></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4 text-emerald-600" />Activity Timeline</CardTitle>
          <div className="flex items-center gap-1.5">
            {(["all", "success", "failed", "agent"] as const).map(f => {
              const count = f === "all" ? data.timeline.length : f === "agent" ? data.timeline.filter(t => t.trigger === "auto").length : data.timeline.filter(t => t.status === f).length;
              if (count === 0 && f !== "all") return null;
              return <button key={f} type="button" onClick={() => setFilter(f)} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors", filter === f ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border text-muted-foreground hover:bg-accent")}>{f === "all" ? "All" : f === "agent" ? "Agent" : f}<span className="tabular-nums opacity-60">{count}</span></button>;
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[500px] overflow-y-auto">
          <div className="relative px-4 py-2">
            <div className="absolute left-7 top-0 bottom-0 w-px bg-border" />
            {filtered.map(item => {
              const Icon = ICON_MAP[item.icon] ?? ScrollText;
              const statusColor = item.status ? STATUS_COLORS[item.status] : "text-muted-foreground";
              return (
                <button key={item.id} type="button" disabled={!item.runId} onClick={() => item.runId && onOpenRun?.(item.runId)} className={cn("relative flex items-start gap-3 pb-4 text-left transition-colors", item.runId && "cursor-pointer hover:bg-accent/30")}>
                  <div className={cn("z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-background bg-card", statusColor)}><Icon className="size-3.5" /></div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{item.title}</span>{item.status && <span className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px]", statusColor)}>{item.status}</span>}{item.trigger && TRIGGER_LABELS[item.trigger] && <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px]">{TRIGGER_LABELS[item.trigger]}</span>}</div>
                    <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                    <div className="flex items-center gap-2 pt-0.5 text-[10px] text-muted-foreground"><Clock className="size-2.5" />{formatRelativeTime(item.timestamp)}{item.durationMs != null && item.durationMs > 0 && <><span>·</span><Zap className="size-2.5" />{(item.durationMs / 1000).toFixed(1)}s</>}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}
