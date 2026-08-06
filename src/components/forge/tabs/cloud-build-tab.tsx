"use client";

// ============================================================
// Cloud Build tab — builds run on GitHub's FREE runners.
// Forge dispatches forge-remote-build.yml via /api/forge/gha-build
// (control plane can live on free Workers; builds get real Linux
// compute on GitHub-hosted runners — free forever for public repos).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, Loader2, Play, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface GhaArtifact {
  id: number;
  name: string;
  sizeInBytes: number;
  downloadUrl: string;
}

interface GhaJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

interface GhaStatus {
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  jobs: GhaJob[];
  logs?: string | null;
  artifacts?: GhaArtifact[];
}

const BADGE: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failure: "bg-red-500/10 text-red-700 dark:text-red-300",
  cancelled: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  in_progress: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  queued: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function StatusPill({ status, conclusion }: { status: string; conclusion: string | null }) {
  const key = status === "completed" ? (conclusion ?? "pending") : status;
  const cls = BADGE[key] ?? "bg-zinc-500/10 text-zinc-600";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {(status === "queued" || status === "in_progress") && (
        <Loader2 className="size-3 animate-spin" />
      )}
      {status === "completed" ? (conclusion ?? "done") : status}
    </span>
  );
}

export function CloudBuildTab({ projectId }: { projectId: string }) {
  const [buildCmd, setBuildCmd] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [run, setRun] = useState<{
    forgeRunId: string;
    ghaRunId: number | null;
    runUrl: string | null;
  } | null>(null);
  const [status, setStatus] = useState<GhaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (ghaRunId: number): Promise<GhaStatus | null> => {
    try {
      const r = await fetch(`/api/forge/gha-build/${ghaRunId}?logs=1`);
      const j = await r.json();
      if (j.ok) {
        setStatus(j.data);
        return j.data as GhaStatus;
      }
      setError(j.error ?? "status fetch failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return null;
  }, []);

  // Poll while the build is running.
  useEffect(() => {
    const ghaRunId = run?.ghaRunId;
    if (!ghaRunId) return;
    let stop = false;
    const tick = async () => {
      const s = await refresh(ghaRunId);
      if (stop) return;
      if (s && s.status !== "completed") {
        timer.current = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => {
      stop = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run?.ghaRunId, refresh]);

  const dispatch = async () => {
    setDispatching(true);
    setError(null);
    setStatus(null);
    try {
      const r = await fetch("/api/forge/gha-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          buildCmd: buildCmd.trim() || undefined,
          runId: `ui-${Date.now()}`,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "dispatch failed");
      setRun({
        forgeRunId: j.data.forgeRunId,
        ghaRunId: j.data.ghaRunId,
        runUrl: j.data.runUrl,
      });
      toast.success("Build dispatched to a free GitHub runner");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setDispatching(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-border bg-emerald-500/5 p-2">
            <Cloud className="size-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Cloud Build — free GitHub runners</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Builds run on GitHub-hosted runners (free for public repos) — real Linux
              compute with bun, node, python + uv. Forge streams your project source to
              the runner and reports back. No paid plan, no local machine.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={buildCmd}
            onChange={(e) => setBuildCmd(e.target.value)}
            placeholder="Build command (empty = auto-detect: bun/npm/uv)"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-emerald-500/50"
          />
          <Button size="sm" onClick={dispatch} disabled={dispatching} className="gap-1.5">
            {dispatching ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {dispatching ? "Dispatching…" : "Build in Cloud"}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {status && (
          <div className="space-y-3 rounded-md border border-border bg-card/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={status.status} conclusion={status.conclusion} />
              <span className="text-[11px] text-muted-foreground">
                run #{status.id} · started {status.createdAt ? new Date(status.createdAt).toLocaleTimeString() : ""}
              </span>
              {status.htmlUrl && (
                <a
                  href={status.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  <ExternalLink className="size-3" />
                  View on GitHub
                </a>
              )}
            </div>

            {(status.jobs ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(status.jobs ?? []).map((job) => (
                  <span key={job.id} className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {job.name}: {job.status === "completed" ? (job.conclusion ?? "done") : job.status}
                  </span>
                ))}
              </div>
            )}

            {status.logs && (
              <pre className="max-h-64 overflow-auto rounded-md bg-zinc-950 p-3 text-[10px] leading-relaxed text-zinc-200">
                {status.logs.slice(-20000)}
              </pre>
            )}

            {(status.artifacts ?? []).length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">Build outputs</p>
                {(status.artifacts ?? []).map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded border border-border bg-background px-2 py-1 text-[11px]">
                    <span className="font-mono">{a.name}</span>
                    <span className="text-muted-foreground">{(a.sizeInBytes / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
