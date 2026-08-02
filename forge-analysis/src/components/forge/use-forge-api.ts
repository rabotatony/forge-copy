"use client";

import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types (mirror the Forge API contract — kept here so all components import
// from one place).
// ---------------------------------------------------------------------------

export type ForgeKind = "node" | "python" | "rust" | "go" | "unknown";
export type RunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "waiting_approval";
export type LogStream = "stdout" | "stderr" | "system";

export interface ProjectListItem {
  id: string;
  name: string;
  fileName: string;
  kind: ForgeKind;
  fileSize: number;
  fileCount: number;
  createdAt: string;
  runCount: number;
  lastRunStatus: RunStatus | null;
}

export interface ProjectListResponse {
  projects: ProjectListItem[];
}

export interface SuggestedWorkflow {
  key: string;
  name: string;
  description: string;
  icon: string;
}

export interface FullWorkflow {
  key: string;
  name: string;
  description: string;
  icon: string;
  requiresApproval: boolean;
  secrets: string[];
  cache: { label: string; paths: string[]; keyGenerator: string } | null;
  testReport: { format: string; path: string } | null;
}

export interface RunSummary {
  id: string;
  workflow: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  trigger?: string | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  fileName: string;
  extractedPath: string;
  fileSize: number;
  fileCount: number;
  kind: ForgeKind;
  detection: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProjectDetailResponse {
  project: ProjectDetail;
  suggestedWorkflows: SuggestedWorkflow[];
  recentRuns: RunSummary[];
}

export interface FileNode {
  type: "dir" | "file";
  path: string;
  size: number;
  childrenCount?: number;
}

export interface FileTreeResponse {
  tree: FileNode[];
  totalFiles: number;
  truncated: boolean;
}

export interface FileContentResponse {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface RunArtifact {
  id: string;
  name: string;
  size: number;
  mime: string;
  createdAt: string;
}

export interface RunDetail {
  id: string;
  projectId: string;
  workflow: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  trigger?: string | null;
}

export interface RunDetailResponse {
  run: RunDetail;
  logCount: number;
  artifacts: RunArtifact[];
}

export interface LogLine {
  seq: number;
  stream: LogStream;
  text: string;
  ts: string;
}

export interface RunLogsResponse {
  logs: LogLine[];
  truncated: boolean;
  total: number;
}

export interface RunStreamEvent {
  type: "log" | "status" | "artifact" | "done";
  runId?: string;
  log?: LogLine;
  status?: RunStatus;
  artifact?: RunArtifact;
  exitCode?: number | null;
  durationMs?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useProjects() {
  return useQuery({
    queryKey: ["forge", "projects"],
    queryFn: async () =>
      jsonOrThrow<ProjectListResponse>(
        await fetch("/api/forge/projects"),
      ),
    refetchInterval: 15_000,
  });
}

export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId],
    queryFn: async () =>
      jsonOrThrow<ProjectDetailResponse>(
        await fetch(`/api/forge/projects/${projectId}`),
      ),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Intent detection — Forge figures out what the user wants to produce
// ---------------------------------------------------------------------------

export interface IntentSignal {
  intent: string;
  reason: string;
  confidence: number;
  evidence: string[];
}

export interface IntentResponse {
  intent: string;
  intentLabel: string;
  intentEmoji: string;
  intentDescription: string;
  summary: string;
  signals: IntentSignal[];
  primary: string | null;
  recommended: string[];
  autoRun: string[];
  available: string[];
  primaryAvailable: boolean;
  reasons: Record<string, string>;
}

export function useProjectIntent(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId, "intent"],
    queryFn: async () =>
      jsonOrThrow<IntentResponse>(
        await fetch(`/api/forge/projects/${projectId}/intent`),
      ),
    enabled: !!projectId,
    // Intent doesn't change unless files change — cache longer.
    staleTime: 60_000,
  });
}

export function useAutoRun(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const r = await fetch(
        `/api/forge/projects/${projectId}/intent/auto-run`,
        { method: "POST" },
      );
      return jsonOrThrow<{ runId: string; workflow: string; intent: string; intentLabel: string }>(r);
    },
    onSuccess: (_data, _vars) => {
      qc.invalidateQueries({ queryKey: ["forge", "projects"] });
      if (projectId) {
        qc.invalidateQueries({
          queryKey: ["forge", "projects", projectId],
        });
      }
    },
  });
}

export interface WorkflowsResponse {
  workflows: FullWorkflow[];
}

export function useProjectWorkflows(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId, "workflows"],
    queryFn: async () =>
      jsonOrThrow<WorkflowsResponse>(
        await fetch(`/api/forge/projects/${projectId}/workflows`),
      ),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Global system stats (home page dashboard)
// ---------------------------------------------------------------------------

export interface ActivityItem {
  id: string;
  workflow: string;
  status: RunStatus;
  startedAt: string;
  durationMs: number | null;
  trigger: string | null;
  projectName: string;
  projectKind: ForgeKind;
}

export interface SystemStats {
  projects: number;
  totalRuns: number;
  recentRuns: number;
  successCount: number;
  failedCount: number;
  canceledCount: number;
  runningCount: number;
  successRate: number;
  avgDurationMs: number;
  topWorkflows: { workflow: string; count: number }[];
  recentActivity: ActivityItem[];
}

export function useSystemStats() {
  return useQuery({
    queryKey: ["forge", "stats"],
    queryFn: async () =>
      jsonOrThrow<SystemStats>(await fetch("/api/forge/stats")),
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Deployment environments
// ---------------------------------------------------------------------------

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  requiresApproval: boolean;
  requiredReviewers: number;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  deployments?: Deployment[];
}

export interface Deployment {
  id: string;
  environmentId: string;
  runId: string | null;
  status: string;
  version: string | null;
  deployedAt: string | null;
  deployedBy: string | null;
  createdAt: string;
}

export function useEnvironments(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId, "environments"],
    queryFn: async () =>
      jsonOrThrow<{ environments: Environment[] }>(
        await fetch(`/api/forge/projects/${projectId}/environments`),
      ),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useCreateEnvironment(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      name: string;
      description?: string;
      requiresApproval?: boolean;
      requiredReviewers?: number;
      url?: string;
    }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/environments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      return jsonOrThrow<{ environment: Environment }>(r);
    },
    onSuccess: () => {
      if (projectId) {
        qc.invalidateQueries({
          queryKey: ["forge", "projects", projectId, "environments"],
        });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Workflow presets
// ---------------------------------------------------------------------------

export function useRunPreset(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (presetId: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/presets/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ presetId }),
      });
      return jsonOrThrow<{
        pipelineId: string;
        pipelineRunId: string;
        presetId: string;
        presetName: string;
        steps: string[];
      }>(r);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "projects"] });
      if (projectId) {
        qc.invalidateQueries({
          queryKey: ["forge", "projects", projectId],
        });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Re-run a run (with optional env/timeout overrides)
// ---------------------------------------------------------------------------

export function useReRunRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      runId: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      retry?: number;
    }) => {
      const r = await fetch(`/api/forge/runs/${args.runId}/rerun`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          env: args.env,
          timeoutMs: args.timeoutMs,
          retry: args.retry,
        }),
      });
      return jsonOrThrow<{ runId: string; reRunOf: string }>(r);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "runs"] });
      qc.invalidateQueries({ queryKey: ["forge", "projects"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Run summary (markdown, like $GITHUB_STEP_SUMMARY)
// ---------------------------------------------------------------------------

export function useRunSummary(runId: string | null) {
  return useQuery({
    queryKey: ["forge", "runs", runId, "summary"],
    queryFn: async () =>
      jsonOrThrow<{ summary: string | null }>(
        await fetch(`/api/forge/runs/${runId}/summary`),
      ),
    enabled: !!runId,
  });
}

export function useSaveSummary(runId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const r = await fetch(`/api/forge/runs/${runId}/summary`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      return jsonOrThrow<{ summary: string }>(r);
    },
    onSuccess: () => {
      if (runId) {
        qc.invalidateQueries({
          queryKey: ["forge", "runs", runId, "summary"],
        });
      }
    },
  });
}

export function useProjectFiles(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId, "files"],
    queryFn: async () =>
      jsonOrThrow<FileTreeResponse>(
        await fetch(`/api/forge/projects/${projectId}/files`),
      ),
    enabled: !!projectId,
  });
}

export function useFileContent(projectId: string | null, path: string | null) {
  return useQuery({
    queryKey: ["forge", "projects", projectId, "files", "content", path],
    queryFn: async () =>
      jsonOrThrow<FileContentResponse>(
        await fetch(
          `/api/forge/projects/${projectId}/files/content?path=${encodeURIComponent(path!)}`,
        ),
      ),
    enabled: !!projectId && !!path,
  });
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["forge", "runs", runId],
    queryFn: async () =>
      jsonOrThrow<RunDetailResponse>(
        await fetch(`/api/forge/runs/${runId}`),
      ),
    enabled: !!runId,
    // Poll for status updates while the run is non-terminal; once terminal
    // (success/failed/canceled) we stop. React Query will re-evaluate this
    // on each refetch.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 2_000;
      const st = data.run.status;
      if (st === "running" || st === "queued") return 2_000;
      return false;
    },
  });
}

export function useRunLogs(runId: string | null) {
  return useQuery({
    queryKey: ["forge", "runs", runId, "logs"],
    queryFn: async () =>
      jsonOrThrow<RunLogsResponse>(
        await fetch(`/api/forge/runs/${runId}/logs`),
      ),
    enabled: !!runId,
    // Only fetch logs once on mount; the live stream handles updates after.
    // Re-fetch when the run becomes terminal so the final tail is correct.
    staleTime: Infinity,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      projectId: string;
      workflow: string;
      trigger?: string;
    }) => {
      const r = await fetch("/api/forge/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...args, trigger: args.trigger ?? "manual" }),
      });
      return jsonOrThrow<{ runId: string; status: RunStatus }>(r);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["forge", "projects"] });
      qc.invalidateQueries({
        queryKey: ["forge", "projects", vars.projectId],
      });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const r = await fetch(`/api/forge/runs/${runId}/cancel`, {
        method: "POST",
      });
      return jsonOrThrow<{ ok: boolean }>(r);
    },
    onSuccess: (_d, runId) => {
      qc.invalidateQueries({ queryKey: ["forge", "runs", runId] });
      qc.invalidateQueries({ queryKey: ["forge", "projects"] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}`, {
        method: "DELETE",
      });
      return jsonOrThrow<{ ok: boolean }>(r);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "projects"] });
    },
  });
}

/**
 * Upload a ZIP file to /api/forge/upload. Uses XHR so we can report
 * progress events to the caller (fetch() doesn't have an upload progress API).
 * Returns a mutation plus the current progress (0-100) and the in-flight file.
 */
export interface UploadState {
  progress: number; // 0..100
  fileName: string | null;
}

export function useUploadZip() {
  const qc = useQueryClient();
  const [state, setState] = useState<UploadState>({
    progress: 0,
    fileName: null,
  });
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      return new Promise<{ project: ProjectListItem }>((resolve, reject) => {
        const fd = new FormData();
        fd.append("file", file);

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        setState({ progress: 0, fileName: file.name });

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setState({ progress: pct, fileName: file.name });
          }
        };

        xhr.onload = () => {
          setState({ progress: 100, fileName: file.name });
          let body: { project: ProjectListItem } | { error?: string };
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            reject(new Error("Upload failed: invalid JSON response"));
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(body as { project: ProjectListItem });
          } else {
            reject(
              new Error(
                (body as { error?: string })?.error ??
                  `Upload failed: ${xhr.status}`,
              ),
            );
          }
        };

        xhr.onerror = () =>
          reject(new Error("Upload failed: network error"));
        xhr.onabort = () =>
          reject(new Error("Upload canceled"));

        xhr.open("POST", "/api/forge/upload");
        xhr.send(fd);
      });
    },
    onMutate: (file) => {
      setState({ progress: 0, fileName: file.name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "projects"] });
    },
    onSettled: () => {
      xhrRef.current = null;
      // keep last progress visible briefly; caller resets when transitioning
    },
    onError: () => {
      // progress is shown until caller decides what to do
    },
  });

  return { ...mutation, uploadState: state };
}

// ---------------------------------------------------------------------------
// SSE live-run stream
// ---------------------------------------------------------------------------

/**
 * Subscribe to the run's live SSE stream. Each parsed event is forwarded to
 * `onEvent`. The stream is opened once per runId and closed on cleanup or
 * when a `done` event arrives.
 *
 * Caller is expected to keep `onEvent` stable (e.g. useCallback) so we don't
 * re-subscribe on every render.
 */
export function useRunStream(
  runId: string | null,
  onEvent: (e: RunStreamEvent) => void,
  onDone?: () => void,
) {
  // Store the latest callbacks in refs so the effect only depends on runId.
  // Refs are updated inside an effect (not during render) per the
  // react-hooks/refs rule.
  const cbRef = useRef(onEvent);
  const doneRef = useRef(onDone);
  useEffect(() => {
    cbRef.current = onEvent;
    doneRef.current = onDone;
  });

  useEffect(() => {
    if (!runId) return;
    let closed = false;
    const es = new EventSource(`/api/forge/runs/${runId}/stream`);

    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as RunStreamEvent;
        cbRef.current(ev);
        if (ev.type === "done") {
          closed = true;
          es.close();
          doneRef.current?.();
        }
      } catch {
        /* ignore malformed */
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; on terminal runs the server closes the
      // stream so an error here is expected. We let the polling on useRun
      // sort out the final state.
      if (closed) return;
    };

    return () => {
      closed = true;
      es.close();
    };
  }, [runId]);
}
