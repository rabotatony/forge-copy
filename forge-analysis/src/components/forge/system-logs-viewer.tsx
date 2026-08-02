"use client";

/**
 * SystemLogsViewer
 *
 * Terminal-style log viewer that shows the most recent system events
 * across ALL Forge projects (not scoped to a single project).
 *
 * - Polls /api/forge/system-logs every 15 seconds (TanStack Query)
 * - Dark terminal surface (bg-zinc-950), monospace text
 * - Each event row: timestamp · project · workflow · status badge · log text
 * - Status colors: success=emerald, failed=red, running=amber, system=zinc
 * - No indigo / blue per design rules
 * - No props — fully self-contained
 */
import { useQuery } from "@tanstack/react-query";
import { Terminal, Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types — mirror the API response shape exactly (no `any`).
// ---------------------------------------------------------------------------

interface SystemEvent {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  workflow: string;
  status: string;
  stream: string;
  text: string;
  ts: string;
}

interface SystemLogsResponse {
  events: SystemEvent[];
}

// ---------------------------------------------------------------------------
// Status styling — keyed on the run status string from the DB.
// success=emerald, failed=red, running=amber, system=zinc, fallback=zinc.
// ---------------------------------------------------------------------------

type StatusColor = "emerald" | "red" | "amber" | "zinc";

function statusColor(status: string): StatusColor {
  switch (status) {
    case "success":
      return "emerald";
    case "failed":
    case "error":
      return "red";
    case "running":
    case "waiting_approval":
      return "amber";
    default:
      // queued / canceled / unknown → zinc
      return "zinc";
  }
}

const STATUS_TEXT_CLASS: Record<StatusColor, string> = {
  emerald: "text-emerald-400",
  red: "text-red-400",
  amber: "text-amber-400",
  zinc: "text-zinc-400",
};

const STATUS_BADGE_CLASS: Record<StatusColor, string> = {
  emerald:
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  red: "bg-red-500/10 text-red-400 border-red-500/30",
  amber:
    "bg-amber-500/10 text-amber-400 border-amber-500/30",
  zinc: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO timestamp as HH:MM:SS for compact terminal display. */
function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SystemLogsViewer() {
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["forge", "system-logs"],
    queryFn: async (): Promise<SystemLogsResponse> => {
      const res = await fetch("/api/forge/system-logs", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load system logs (HTTP ${res.status})`);
      }
      return (await res.json()) as SystemLogsResponse;
    },
    refetchInterval: 15_000, // auto-refresh every 15s
    refetchOnWindowFocus: true,
  });

  const events = data?.events ?? [];

  return (
    <Card className="gap-0 overflow-hidden border-zinc-800 bg-zinc-950 py-0 text-zinc-100">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Terminal className="size-4 text-emerald-400" aria-hidden />
            System Logs
            <span className="text-xs font-normal text-zinc-500">
              across all projects
            </span>
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Activity className="size-3.5 text-emerald-400" aria-hidden />
            <span>{events.length} events</span>
            {(isLoading || isFetching) && (
              <Loader2
                className="size-3.5 animate-spin text-zinc-500"
                aria-hidden
              />
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-0 py-0">
        <div
          className="max-h-[600px] overflow-y-auto bg-zinc-950 font-mono text-xs leading-relaxed"
          role="log"
          aria-live="polite"
          aria-label="System log events"
        >
          {isError ? (
            <div className="px-4 py-6 text-red-400">
              Error loading system logs:{" "}
              {error instanceof Error ? error.message : "unknown error"}
            </div>
          ) : isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-zinc-400">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading system logs…
            </div>
          ) : events.length === 0 ? (
            <div className="px-4 py-6 text-zinc-500">
              No system events yet. Runs will appear here as they execute.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-900">
              {events.map((ev) => {
                const color = statusColor(ev.status);
                return (
                  <li
                    key={ev.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-zinc-900/40"
                  >
                    <span className="shrink-0 text-zinc-500 tabular-nums">
                      {formatTime(ev.ts)}
                    </span>

                    <span className="shrink-0 font-semibold text-zinc-200">
                      {ev.projectName}
                    </span>

                    <span className="shrink-0 text-zinc-500">
                      <span className="text-zinc-600">/</span>
                      <span className="ml-1 text-zinc-400">{ev.workflow}</span>
                    </span>

                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 border px-1.5 py-0 text-[10px] font-medium uppercase",
                        STATUS_BADGE_CLASS[color],
                      )}
                      aria-label={`Status: ${ev.status}`}
                    >
                      {ev.status}
                    </Badge>

                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words",
                        STATUS_TEXT_CLASS[color],
                      )}
                    >
                      {ev.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
