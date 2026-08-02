"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCompare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRelativeTime, shortId } from "./format";

// ---------------------------------------------------------------------------
// Types — mirror the contracts of the two endpoints we consume:
//   GET /api/forge/projects/[id]      -> { recentRuns: RecentRun[] }
//   GET /api/forge/runs/[id]/logs     -> { logs: LogLine[], ... }
// Kept inline so the component is a self-contained drop-in.
// ---------------------------------------------------------------------------

interface RecentRun {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
}

interface ProjectDetailResponse {
  recentRuns: RecentRun[];
}

interface LogLine {
  seq: number;
  stream: string;
  text: string;
  ts: string;
}

interface LogsResponse {
  logs: LogLine[];
  truncated: boolean;
  total: number;
}

type DiffKind = "same" | "removed" | "added" | "changed";

interface DiffRow {
  kind: DiffKind;
  lineA: string | null;
  lineB: string | null;
  index: number;
}

interface DiffStats {
  same: number;
  removed: number;
  added: number;
  changed: number;
}

// ---------------------------------------------------------------------------
// Log flattening + simple diff
// ---------------------------------------------------------------------------

/**
 * Flatten the API's `logs` array (where each `LogLine.text` may itself span
 * multiple lines) into a flat string array. Empty trailing segments produced
 * by a final newline are dropped; otherwise every newline becomes a new diff
 * entry so terminal-style line numbering stays accurate.
 */
function flattenLogs(logs: LogLine[] | undefined): string[] {
  if (!logs || logs.length === 0) return [];
  const out: string[] = [];
  for (const log of logs) {
    const segments = log.text.split("\n");
    if (segments.length > 1 && segments[segments.length - 1] === "") {
      segments.pop();
    }
    for (const s of segments) out.push(s);
  }
  return out;
}

/**
 * Build a simple line-by-line diff between two flat log arrays. Comparison is
 * exact string equality at the same index — no LCS, no fuzzy matching.
 *
 * Result kinds:
 *   - "same"     : both sides have the same line at this index
 *   - "removed"  : only Run A has a line at this index
 *   - "added"    : only Run B has a line at this index
 *   - "changed"  : both sides have a line, but the text differs
 */
function buildDiff(linesA: string[], linesB: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const max = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < max; i++) {
    const a = i < linesA.length ? linesA[i] : null;
    const b = i < linesB.length ? linesB[i] : null;
    let kind: DiffKind;
    if (a !== null && b !== null) {
      kind = a === b ? "same" : "changed";
    } else if (a !== null) {
      kind = "removed";
    } else {
      kind = "added";
    }
    rows.push({ kind, lineA: a, lineB: b, index: i + 1 });
  }
  return rows;
}

function computeStats(rows: DiffRow[]): DiffStats {
  const stats: DiffStats = { same: 0, removed: 0, added: 0, changed: 0 };
  for (const r of rows) {
    stats[r.kind] += 1;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Cell styling — pure helpers, kept module-scope to avoid any
// `react-hooks/static-components` lint issues.
// ---------------------------------------------------------------------------

interface CellStyle {
  /** Tailwind classes for the cell background + text color. */
  className: string;
  /** Whether the cell is a "filler" (the opposite side has the real content). */
  filler: boolean;
}

const CELL_SAME: CellStyle = {
  className: "text-zinc-500",
  filler: false,
};

const CELL_REMOVED: CellStyle = {
  className: "bg-red-500/10 text-red-300",
  filler: false,
};

const CELL_ADDED: CellStyle = {
  className: "bg-emerald-500/10 text-emerald-300",
  filler: false,
};

const CELL_FILLER: CellStyle = {
  className: "bg-zinc-900/40 text-zinc-700",
  filler: true,
};

/**
 * Resolve the left (Run A) cell style for a given row kind. "removed" and
 * "changed" rows show Run A content with a red tint; "added" rows show a
 * neutral filler because Run A has no line at that index.
 */
function leftCellStyle(kind: DiffKind): CellStyle {
  if (kind === "removed" || kind === "changed") return CELL_REMOVED;
  if (kind === "added") return CELL_FILLER;
  return CELL_SAME;
}

/**
 * Resolve the right (Run B) cell style. "added" and "changed" rows show Run B
 * content with an emerald tint; "removed" rows show a neutral filler.
 */
function rightCellStyle(kind: DiffKind): CellStyle {
  if (kind === "added" || kind === "changed") return CELL_ADDED;
  if (kind === "removed") return CELL_FILLER;
  return CELL_SAME;
}

// ---------------------------------------------------------------------------
// RunDiffViewer
// ---------------------------------------------------------------------------

/**
 * RunDiffViewer — terminal-style side-by-side log diff between two runs of
 * the same project.
 *
 * Workflow:
 *   1. Fetch the project detail endpoint to populate the two run dropdowns
 *      (Run A / Run B) with the project's 10 most recent runs.
 *   2. Once both runs are selected, fetch both runs' logs in parallel via
 *      `Promise.all` (two `fetch` calls).
 *   3. Flatten each side's log lines (splitting on embedded newlines) and
 *      build a simple line-by-line diff. Matching lines are muted; lines
 *      only in Run A get a red-tinted background; lines only in Run B get
 *      an emerald-tinted background; differing lines show both colors.
 *
 * Accent colors: emerald (new/added) and red (removed). No indigo or blue
 * is used anywhere in the component.
 */
export function RunDiffViewer({ projectId }: { projectId: string }) {
  const [selectedA, setSelectedA] = useState<string>("");
  const [selectedB, setSelectedB] = useState<string>("");

  // ----- Fetch the project's recent runs to populate the dropdowns. -----
  const {
    data: projectData,
    isLoading: projectLoading,
    isError: projectError,
    error: projectErr,
  } = useQuery({
    queryKey: ["forge", "projects", projectId, "diff-viewer"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Failed to load project (${r.status})`,
        );
      }
      return (await r.json()) as ProjectDetailResponse;
    },
    staleTime: 30_000,
    retry: false,
  });

  const runs = projectData?.recentRuns ?? [];

  // ----- Fetch logs for both selected runs in parallel. -----
  const {
    data: logsData,
    isLoading: logsLoading,
    isError: logsError,
    error: logsErr,
  } = useQuery({
    queryKey: ["forge", "run-diff-logs", selectedA, selectedB],
    queryFn: async () => {
      const [aRes, bRes] = await Promise.all([
        fetch(`/api/forge/runs/${selectedA}/logs`),
        fetch(`/api/forge/runs/${selectedB}/logs`),
      ]);
      if (!aRes.ok || !bRes.ok) {
        const failedSide = !aRes.ok ? "Run A" : "Run B";
        const failedRes = !aRes.ok ? aRes : bRes;
        const body = (await failedRes
          .json()
          .catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? `Failed to fetch logs for ${failedSide} (${failedRes.status})`,
        );
      }
      const [a, b] = await Promise.all([
        aRes.json() as Promise<LogsResponse>,
        bRes.json() as Promise<LogsResponse>,
      ]);
      return { a, b };
    },
    // Only fetch once the user has picked both runs.
    enabled: !!selectedA && !!selectedB,
    staleTime: 15_000,
    retry: false,
  });

  const rows = useMemo(() => {
    if (!logsData) return [];
    const linesA = flattenLogs(logsData.a.logs);
    const linesB = flattenLogs(logsData.b.logs);
    return buildDiff(linesA, linesB);
  }, [logsData]);

  const stats = useMemo(
    () => (rows.length > 0 ? computeStats(rows) : null),
    [rows],
  );

  const bothSelected = !!selectedA && !!selectedB;

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="size-4 text-emerald-500" />
          Run Diff Viewer
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Compare logs between two runs side-by-side. Matching lines are muted;
          removed lines (Run A only) are red; added lines (Run B only) are emerald.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ---- Dropdowns ---- */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Run A
            </span>
            <select
              value={selectedA}
              onChange={(e) => setSelectedA(e.target.value)}
              disabled={projectLoading}
              aria-label="Select Run A"
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">Select run…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.workflow} · {formatRelativeTime(r.startedAt)} ·{" "}
                  {shortId(r.id)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Run B
            </span>
            <select
              value={selectedB}
              onChange={(e) => setSelectedB(e.target.value)}
              disabled={projectLoading}
              aria-label="Select Run B"
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">Select run…</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.workflow} · {formatRelativeTime(r.startedAt)} ·{" "}
                  {shortId(r.id)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ---- Project load error ---- */}
        {projectError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {projectErr instanceof Error
              ? projectErr.message
              : "Failed to load project runs."}
          </p>
        )}

        {/* ---- Diff stats ---- */}
        {stats && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground tabular-nums">
              {stats.same} same
            </span>
            <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-red-700 tabular-nums dark:text-red-300">
              {stats.removed} removed
            </span>
            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-700 tabular-nums dark:text-emerald-300">
              {stats.added} added
            </span>
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-700 tabular-nums dark:text-amber-300">
              {stats.changed} changed
            </span>
            {(logsData?.a.truncated || logsData?.b.truncated) && (
              <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-700 tabular-nums dark:text-amber-300">
                logs truncated
              </span>
            )}
          </div>
        )}

        {/* ---- Terminal-style diff panel ---- */}
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          {/* Column header */}
          <div className="grid grid-cols-2 border-b border-zinc-800 bg-zinc-900 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            <div className="px-3 py-1.5">Run A</div>
            <div className="border-l border-zinc-800 px-3 py-1.5">Run B</div>
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            {!bothSelected ? (
              <div className="px-3 py-8 text-center text-sm text-zinc-500">
                Select two runs to compare their logs.
              </div>
            ) : logsLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-zinc-400">
                <Loader2 className="size-4 animate-spin" />
                Fetching logs…
              </div>
            ) : logsError ? (
              <div className="px-3 py-8 text-center text-sm text-red-400">
                {logsErr instanceof Error
                  ? logsErr.message
                  : "Failed to load logs."}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-zinc-500">
                No log lines for the selected runs.
              </div>
            ) : (
              <div className="font-mono text-xs">
                {rows.map((row) => {
                  const left = leftCellStyle(row.kind);
                  const right = rightCellStyle(row.kind);
                  // Use a non-breaking space for empty cells so the row keeps
                  // its height and the tinted background is visible.
                  const leftText =
                    row.lineA !== null && !left.filler
                      ? row.lineA
                      : "\u00A0";
                  const rightText =
                    row.lineB !== null && !right.filler
                      ? row.lineB
                      : "\u00A0";
                  return (
                    <div
                      key={row.index}
                      className="grid grid-cols-2 border-b border-zinc-900/60 last:border-b-0"
                    >
                      <div
                        className={cn(
                          "whitespace-pre-wrap break-all border-r border-zinc-900/60 px-2 py-0.5",
                          left.className,
                        )}
                      >
                        <span className="mr-2 inline-block w-8 shrink-0 select-none text-right text-[10px] tabular-nums text-zinc-600">
                          {left.filler ? "" : row.index}
                        </span>
                        {leftText}
                      </div>
                      <div
                        className={cn(
                          "whitespace-pre-wrap break-all px-2 py-0.5",
                          right.className,
                        )}
                      >
                        <span className="mr-2 inline-block w-8 shrink-0 select-none text-right text-[10px] tabular-nums text-zinc-600">
                          {right.filler ? "" : row.index}
                        </span>
                        {rightText}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
