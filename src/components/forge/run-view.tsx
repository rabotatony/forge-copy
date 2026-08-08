"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  Ban,
  Download,
  Copy,
  ArrowDownToLine,
  Loader2,
  FileBox,
  Timer,
  CalendarClock,
  Hammer,
  CircleCheck,
  CircleX,
  CircleDot,
  RotateCw,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCancelRun,
  useRun,
  useRunStream,
  useReRunRun,
  type LogLine,
  type RunArtifact,
  type RunStatus,
  type RunStreamEvent,
} from "./use-forge-api";
import { StatusBadge } from "./status-badge";
import { LogTerminal } from "./log-terminal";
import { ApprovalBanner, TestReportPanel, LogSearchBar } from "./run-enhancements";
import { BadgeShare } from "./badge-share";
import { RunSummaryPanel } from "./run-summary-panel";
import { AnnotationsPanel } from "./annotations-panel";
import { ArtifactsBrowser } from "./artifacts-browser";
import { RunTimeline } from "./run-timeline";
import { useTranslation } from "./use-translation";
import {
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  shortId,
  formatBytes,
} from "./format";

/**
 * Live run view. Wires together:
 *  - useRun(runId) for run metadata + artifacts (polled while running)
 *  - useRunStream(runId, onEvent) for live log lines + status + done events
 *
 * The SSE stream replays all existing logs from the DB on connect, so we
 * accumulate them into local state and dedupe by seq. Status updates from
 * the stream override the polled status for snappier feedback.
 *
 * Implementation note: the inner stateful component is keyed by runId in the
 * outer wrapper, so changing runs unmounts + remounts the inner component
 * (which naturally resets all accumulated state without needing a
 * setState-in-effect reset, which the react-hooks/set-state-in-effect rule
 * disallows).
 */
export function RunView({
  runId,
  onBack,
  onOpenRun,
}: {
  runId: string;
  onBack: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  return <RunViewInner key={runId} runId={runId} onBack={onBack} onOpenRun={onOpenRun} />;
}

function RunViewInner({
  runId,
  onBack,
  onOpenRun,
}: {
  runId: string;
  onBack: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const { data, isLoading, isError, error } = useRun(runId);
  const cancelMutation = useCancelRun();
  const reRunMutation = useReRunRun();
  const { t } = useTranslation();

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [streamStatus, setStreamStatus] = useState<RunStatus | null>(null);
  const [streamArtifacts, setStreamArtifacts] = useState<RunArtifact[]>([]);
  const [streamExit, setStreamExit] = useState<number | null | undefined>(
    undefined,
  );
  const [streamDuration, setStreamDuration] = useState<number | null | undefined>(
    undefined,
  );
  const [done, setDone] = useState(false);

  const onEvent = useCallback((e: RunStreamEvent) => {
    if (e.type === "log" && e.log) {
      setLogs((prev) => {
        // Dedupe by seq (SSE may replay the same line).
        if (prev.some((l) => l.seq === e.log!.seq)) return prev;
        const next = [...prev, e.log!];
        next.sort((a, b) => a.seq - b.seq);
        return next;
      });
    } else if (e.type === "status" && e.status) {
      setStreamStatus(e.status);
    } else if (e.type === "artifact" && e.artifact) {
      setStreamArtifacts((prev) => {
        if (prev.some((a) => a.id === e.artifact!.id)) return prev;
        return [...prev, e.artifact!];
      });
    } else if (e.type === "done") {
      if (e.status) setStreamStatus(e.status);
      setStreamExit(e.exitCode ?? null);
      setStreamDuration(e.durationMs ?? null);
      setDone(true);
    }
  }, []);

  useRunStream(runId, onEvent);

  // Effective status: stream status wins over polled status (snappier).
  const run = data?.run;
  const effectiveStatus: RunStatus | null =
    streamStatus ?? run?.status ?? null;
  const effectiveExit =
    streamExit !== undefined ? streamExit : run?.exitCode ?? null;
  const effectiveDuration =
    streamDuration !== undefined ? streamDuration : run?.durationMs ?? null;

  // Merge artifacts from stream + run query (run query may include ones we
  // missed before the stream opened).
  const artifacts: RunArtifact[] = (() => {
    const map = new Map<string, RunArtifact>();
    for (const a of streamArtifacts) map.set(a.id, a);
    for (const a of data?.artifacts ?? []) map.set(a.id, a);
    return Array.from(map.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  })();

  const isCancellable =
    effectiveStatus === "running" || effectiveStatus === "queued";
  const isTerminal =
    effectiveStatus === "success" ||
    effectiveStatus === "failed" ||
    effectiveStatus === "canceled";

  const onCancel = async () => {
    try {
      await cancelMutation.mutateAsync(runId);
      toast.info("Run canceled");
    } catch (e) {
      toast.error(
        `Failed to cancel: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  const onReRun = async () => {
    try {
      const result = await reRunMutation.mutateAsync({ runId });
      toast.success("Re-run started");
      const newRunId = (result as { runId?: string })?.runId;
      if (newRunId && onOpenRun) {
        onOpenRun(newRunId);
      }
    } catch (e) {
      toast.error(
        `Failed to re-run: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  if (isLoading) return <RunViewSkeleton onBack={onBack} />;

  if (isError || !run) {
    return (
      <section className="mx-auto w-full max-w-6xl space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2"
          aria-label="Back to project"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load run: {error?.message}
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="forge-reveal mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-3 -ml-2"
          aria-label="Back to project"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("run.back")}
        </Button>
      </div>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Hammer className="size-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight">
                {run.workflow}
              </h1>
              <StatusBadge status={effectiveStatus} />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Run <span className="text-foreground">{shortId(runId, 10, 6)}</span>
              {run.trigger ? ` · ${run.trigger}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isTerminal && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReRun}
              disabled={reRunMutation.isPending}
            >
              {reRunMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RotateCw className="size-4" aria-hidden />
              )}
              Re-run
            </Button>
          )}
          {run.projectId && <BadgeShare projectId={run.projectId} />}
          {isCancellable && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={cancelMutation.isPending}
              className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Ban className="size-4" aria-hidden />
              )}
              Cancel run
            </Button>
          )}
        </div>
      </motion.header>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <RunStat
          icon={CalendarClock}
          label="Started"
          value={formatRelativeTime(run.startedAt)}
          sub={formatDateTime(run.startedAt)}
        />
        <RunStat
          icon={Timer}
          label="Duration"
          value={formatDuration(effectiveDuration)}
          sub={
            run.finishedAt
              ? `finished ${formatRelativeTime(run.finishedAt)}`
              : isTerminal
                ? "done"
                : "in progress"
          }
          pulse={!isTerminal}
        />
        <RunStat
          icon={
            effectiveExit === 0
              ? CircleCheck
              : effectiveExit === null || effectiveExit === undefined
                ? CircleDot
                : CircleX
          }
          label="Exit code"
          value={
            effectiveExit === null || effectiveExit === undefined
              ? isTerminal
                ? "—"
                : "running"
              : effectiveExit.toString()
          }
          tone={
            effectiveExit === 0
              ? "success"
              : effectiveExit === null || effectiveExit === undefined
                ? "muted"
                : "danger"
          }
        />
        <RunStat
          icon={FileBox}
          label="Artifacts"
          value={artifacts.length.toString()}
          sub={
            artifacts.length === 0
              ? isTerminal
                ? "none produced"
                : "pending"
              : "available for download"
          }
        />
      </div>

      {/* Approval banner (if applicable) */}
      <ApprovalBanner runId={runId} />

      {/* Log search bar */}
      <LogSearchBar runId={runId} />

      {/* Live log terminal */}
      <Card className="overflow-hidden">
        <CardHeader className="gap-1 pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    isTerminal
                      ? effectiveStatus === "success"
                        ? "bg-emerald-500"
                        : effectiveStatus === "failed"
                          ? "bg-red-500"
                          : "bg-zinc-500"
                      : "bg-amber-500 animate-pulse",
                  )}
                  aria-hidden
                />
                Live log
              </CardTitle>
              <CardDescription>
                {isTerminal
                  ? `Run ${effectiveStatus} · ${
                      effectiveExit === 0 ? "succeeded" : `exit ${effectiveExit ?? "—"}`
                    }`
                  : "Streaming output as the workflow runs."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const text = logs.map((l) => l.text).join("\n");
                  navigator.clipboard?.writeText(text).then(
                    () => toast.success(`Copied ${logs.length} log lines`),
                    () => toast.error("Copy failed — try Download instead"),
                  );
                }}
                disabled={logs.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                aria-label="Copy logs to clipboard"
              >
                <Copy className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Copy</span>
              </button>
              {effectiveStatus === "failed" && (() => {
                const firstErr = logs.findIndex((l) =>
                  l.stream === "stderr" || /error|fail|exception|traceback|panic/i.test(l.text)
                );
                if (firstErr < 0) return null;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(`log-line-${logs[firstErr]!.seq}`);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      el?.classList.add("bg-red-500/10");
                      setTimeout(() => el?.classList.remove("bg-red-500/10"), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                    aria-label="Jump to first error"
                  >
                    <ArrowDownToLine className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Jump to error</span>
                  </button>
                );
              })()}
              <a
                href={`/api/forge/runs/${runId}/logs/download`}
                download
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Download full log as text file"
              >
                <Download className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Download log</span>
              </a>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <LogTerminal
            logs={logs}
            status={effectiveStatus}
            className="h-[60vh] min-h-[360px]"
          />
        </CardContent>
      </Card>

      {/* Artifacts browser (with preview) */}
      {artifacts.length > 0 && (
        <ArtifactsBrowser runId={runId} />
      )}

      {/* Run timeline (Gantt-style) */}
      <RunTimeline runId={runId} />

      {/* Annotations (errors, warnings, notices) */}
      <AnnotationsPanel runId={runId} />

      {/* Test report panel */}
      <TestReportPanel runId={runId} />

      {/* Run summary (markdown, like $GITHUB_STEP_SUMMARY) */}
      <RunSummaryPanel runId={runId} />

      {/* Done banner */}
      {done && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "flex items-center gap-3 rounded-lg border p-4",
            effectiveStatus === "success"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              : effectiveStatus === "failed"
                ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
                : "border-zinc-500/30 bg-zinc-500/5 text-zinc-700 dark:text-zinc-300",
          )}
          role="status"
        >
          {effectiveStatus === "success" ? (
            <CircleCheck className="size-5" aria-hidden />
          ) : effectiveStatus === "failed" ? (
            <CircleX className="size-5" aria-hidden />
          ) : (
            <Ban className="size-5" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold capitalize">
              Run {effectiveStatus}
            </p>
            <p className="text-xs opacity-90">
              Exit code {effectiveExit ?? "—"} · {formatDuration(effectiveDuration)} ·
              workflow <span className="font-mono">{run.workflow}</span>
            </p>
          </div>
        </motion.div>
      )}
    </section>
  );
}

function RunStat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
  pulse,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "danger" | "muted";
  pulse?: boolean;
}) {
  const toneClasses = {
    default: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    danger: "text-red-600 dark:text-red-400",
    muted: "text-muted-foreground",
  } as const;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <Icon
        className={cn(
          "size-4 shrink-0",
          toneClasses[tone],
          pulse && "animate-pulse",
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={cn("truncate text-sm font-semibold", toneClasses[tone])}>
          {value}
        </div>
        {sub && (
          <div className="truncate text-[10px] text-muted-foreground">{sub}</div>
        )}
      </div>
    </div>
  );
}

function RunViewSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-2"
        aria-label="Back to project"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to project
      </Button>
      <div className="flex gap-3">
        <Skeleton className="size-12 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-[60vh] min-h-[360px] w-full rounded-lg" />
    </section>
  );
}
