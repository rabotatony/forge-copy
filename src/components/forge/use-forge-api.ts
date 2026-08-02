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
  repoUrl?: string | null;
  repoBranch?: string | null;
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
    refetchInterval: (query) => (query.state.error ? false : 15_000), retry: false,
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
    refetchInterval: (query) => (query.state.error ? false : 15_000), retry: false,
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

// ===========================================================================
// Secrets
//
// (Merged from use-forge-api-v2.ts during R-2. The whole `tabs/*` surface
// plus run-enhancements previously imported these from the parallel v2
// module; they now live here so there is one React Query hook module.)
// ===========================================================================
export function useSecrets(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "secrets", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/secrets`);
      return jsonOrThrow<{ secrets: Array<{ id: string; key: string; createdAt: string; updatedAt: string }> }>(r);
    },
    enabled: !!projectId,
  });
}

export function useSetSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { key: string; value: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "secrets", projectId] }),
  });
}

export function useDeleteSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/secrets/${encodeURIComponent(key)}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "secrets", projectId] }),
  });
}

// ===========================================================================
// Env Vars
// ===========================================================================
export function useEnvVars(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "env-vars", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/env-vars`);
      return jsonOrThrow<{ envVars: Array<{ id: string; key: string; value: string }> }>(r);
    },
    enabled: !!projectId,
  });
}

export function useSetEnvVar(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { key: string; value: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/env-vars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "env-vars", projectId] }),
  });
}

export function useDeleteEnvVar(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/env-vars/${encodeURIComponent(key)}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "env-vars", projectId] }),
  });
}

// ===========================================================================
// Cache
// ===========================================================================
export function useCacheEntries(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "cache", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/cache`);
      return jsonOrThrow<{ entries: Array<{ id: string; key: string; label: string; size: number; createdAt: string; lastUsedAt: string; hitCount: number }> }>(r);
    },
    enabled: !!projectId,
  });
}

export function useDeleteCacheEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/cache?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "cache", projectId] }),
  });
}

export function usePruneCache(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (maxEntries: number) => {
      const r = await fetch(`/api/forge/projects/${projectId}/cache/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxEntries }),
      });
      return jsonOrThrow<{ removed: number }>(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "cache", projectId] }),
  });
}

// ===========================================================================
// Triggers
// ===========================================================================
export function useTriggers(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "triggers", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/triggers`);
      return jsonOrThrow<{ triggers: Array<{ id: string; type: string; workflow: string; config: string; enabled: boolean; lastFiredAt: string | null; deliveries?: unknown[] }> }>(r);
    },
    enabled: !!projectId,
  });
}

export function useCreateTrigger(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { type: string; workflow: string; config: Record<string, string>; secret?: string; pipelineId?: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "triggers", projectId] }),
  });
}

export function useDeleteTrigger(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (triggerId: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/triggers/${triggerId}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "triggers", projectId] }),
  });
}

// ===========================================================================
// Notifications
// ===========================================================================
export function useNotifications(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "notifications", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/notifications`);
      return jsonOrThrow<{ notifications: Array<{ id: string; event: string; url: string; enabled: boolean; createdAt: string }> }>(r);
    },
    enabled: !!projectId,
  });
}

export function useCreateNotification(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { event: string; url: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "notifications", projectId] }),
  });
}

export function useDeleteNotification(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/notifications/${notificationId}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "notifications", projectId] }),
  });
}

export function useToggleNotification(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { notificationId: string; enabled: boolean }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/notifications/${vars.notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: vars.enabled }),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "notifications", projectId] }),
  });
}

// ===========================================================================
// Pipelines
// ===========================================================================
export function usePipelines(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "pipelines", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/pipelines`);
      return jsonOrThrow<{ pipelines: Array<{ id: string; name: string; stages: string; createdAt: string }> }>(r);
    },
    enabled: !!projectId,
  });
}

export function useCreatePipeline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; definition: unknown }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/pipelines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "pipelines", projectId] }),
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pipelineId: string) => {
      const r = await fetch(`/api/forge/pipelines/${pipelineId}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge"] }),
  });
}

export function useStartPipelineRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pipelineId: string; trigger?: string }) => {
      const r = await fetch(`/api/forge/pipelines/${vars.pipelineId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: vars.trigger }),
      });
      return jsonOrThrow<{ pipelineRunId: string }>(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge"] }),
  });
}

export function usePipelineRun(pipelineRunId: string | null) {
  return useQuery({
    queryKey: ["forge", "pipeline-run", pipelineRunId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/pipelines/runs/${pipelineRunId}`);
      return jsonOrThrow(r);
    },
    enabled: !!pipelineRunId,
    refetchInterval: 2000,
  });
}

// ===========================================================================
// Analytics
// ===========================================================================
export function useAnalyticsOverview(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "analytics", "overview", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/analytics/overview`);
      return jsonOrThrow<{
        totalRuns: number;
        successRate: number;
        avgDurationMs: number;
        activeRuns: number;
        runsByWorkflow: Array<{ workflow: string; count: number; successRate: number }>;
        runsByStatus: Record<string, number>;
        recentRuns: Array<{ id: string; workflow: string; status: string; startedAt: string; durationMs: number | null }>;
        topFailures: Array<{ workflow: string; totalRuns: number; failedRuns: number; failureRate: number; sampleErrors: string[] }>;
      }>(r);
    },
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function usePerformanceTrends(projectId: string | null, workflow: string) {
  return useQuery({
    queryKey: ["forge", "analytics", "trends", projectId, workflow],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/analytics/trends?workflow=${encodeURIComponent(workflow)}&limit=50`);
      return jsonOrThrow<{ trends: Array<{ runId: string; startedAt: string; durationMs: number | null; status: string; exitCode: number | null }> }>(r);
    },
    enabled: !!projectId && !!workflow,
  });
}

export function useFailurePatterns(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "analytics", "failures", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/analytics/failures`);
      return jsonOrThrow<{ patterns: Array<{ workflow: string; totalRuns: number; failedRuns: number; failureRate: number; lastFailedAt: string | null; sampleErrors: string[] }> }>(r);
    },
    enabled: !!projectId,
  });
}

// ===========================================================================
// Log Search
// ===========================================================================
export function useLogSearch(runId: string | null, query: string, options?: { stream?: string; caseSensitive?: boolean; useRegex?: boolean }) {
  return useQuery({
    queryKey: ["forge", "log-search", runId, query, options],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      if (options?.stream) params.set("stream", options.stream);
      if (options?.caseSensitive) params.set("caseSensitive", "true");
      if (options?.useRegex) params.set("useRegex", "true");
      const r = await fetch(`/api/forge/runs/${runId}/logs/search?${params}`);
      return jsonOrThrow<{ hits: Array<{ seq: number; stream: string; text: string; ts: string }>; count: number }>(r);
    },
    enabled: !!runId && query.length > 0,
  });
}

// ===========================================================================
// Test Report
// ===========================================================================
export function useTestReport(runId: string | null) {
  return useQuery({
    queryKey: ["forge", "test-report", runId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/runs/${runId}/test-report`);
      return jsonOrThrow<{ found: boolean; report?: unknown }>(r);
    },
    enabled: !!runId,
  });
}

// ===========================================================================
// Approval
// ===========================================================================
export function useApproval(runId: string | null) {
  return useQuery({
    queryKey: ["forge", "approval", runId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/runs/${runId}/approval`);
      return jsonOrThrow<{
        required: boolean;
        status?: string;
        requestedAt?: string;
        decidedAt?: string | null;
        decidedBy?: string | null;
        reason?: string | null;
      }>(r);
    },
    enabled: !!runId,
    refetchInterval: 2000,
  });
}

export function useDecideApproval(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { action: "approve" | "reject"; decidedBy: string; reason?: string }) => {
      const r = await fetch(`/api/forge/runs/${runId}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "approval", runId] }),
  });
}

// ===========================================================================
// Custom Workflows
// ===========================================================================
export function useCustomWorkflows(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "custom-workflows", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/custom-workflows`);
      return jsonOrThrow<{ customWorkflows: Array<{ id: string; name: string; workflow: unknown; createdAt: string }> }>(r);
    },
    enabled: !!projectId,
  });
}

export function useSaveCustomWorkflow(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; workflow: unknown }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/custom-workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "custom-workflows", projectId] }),
  });
}

export function useValidateCustomWorkflow(projectId: string) {
  return useMutation({
    mutationFn: async (workflow: unknown) => {
      const r = await fetch(`/api/forge/projects/${projectId}/custom-workflows/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow }),
      });
      return jsonOrThrow<{ valid: boolean; errors: string[] }>(r);
    },
  });
}

export function useRunCustomWorkflow(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { workflowId: string; trigger?: string; matrixValues?: Record<string, string> }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/custom-workflows/${vars.workflowId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: vars.trigger, matrixValues: vars.matrixValues }),
      });
      return jsonOrThrow<{ runId: string }>(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge"] }),
  });
}

// ===========================================================================
// Workflow Catalog
//
// NOTE (R-2): This is a duplicate of useProjectWorkflows above — both hit
// GET /api/forge/projects/:id/workflows with slightly different query keys
// and return shapes. It is preserved verbatim from v2 (with the QK
// convention switched to v1's literal-array style) because the task
// explicitly forbids changing hook public APIs during the merge. A future
// cleanup task should consolidate the two: callers should use
// useProjectWorkflows and this hook should be removed.
// ===========================================================================
export function useWorkflowCatalog(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "workflow-catalog", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/workflows`);
      return jsonOrThrow<{ workflows: Array<{ key: string; name: string; description: string; icon: string; requiresApproval: boolean; secrets: string[]; cache: unknown; testReport: unknown }> }>(r);
    },
    enabled: !!projectId,
  });
}

// ===========================================================================
// Project Settings
// ===========================================================================
export function useProjectSettings(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "settings", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/settings`);
      return jsonOrThrow(r);
    },
    enabled: !!projectId,
  });
}

export function useUpdateSettings(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: Record<string, unknown>) => {
      const r = await fetch(`/api/forge/projects/${projectId}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "settings", projectId] }),
  });
}

// ===========================================================================
// Multi-file upload (supports folder upload via webkitRelativePath)
// ===========================================================================
export function useUploadFiles() {
  const qc = useQueryClient();
  const [state, setState] = useState<UploadState>({ progress: 0, fileName: null });
  const mutation = useMutation({
    mutationFn: async (files: File[]) => {
      return new Promise<{ project: ProjectListItem }>((resolve, reject) => {
        if (files.length === 0) { reject(new Error("No files selected")); return; }
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        const xhr = new XMLHttpRequest();
        setState({ progress: 0, fileName: files.length === 1 ? files[0].name : `${files.length} files` });
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { setState({ progress: Math.round((e.loaded / e.total) * 100), fileName: files.length === 1 ? files[0].name : `${files.length} files` }); } };
        xhr.onload = () => {
          setState({ progress: 100, fileName: files.length === 1 ? files[0].name : `${files.length} files` });
          let body: { project: ProjectListItem } | { error?: string };
          try { body = JSON.parse(xhr.responseText); } catch { reject(new Error("Upload failed: invalid JSON")); return; }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body as { project: ProjectListItem });
          else reject(new Error((body as { error?: string })?.error ?? `Upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Upload failed: network error"));
        xhr.onabort = () => reject(new Error("Upload canceled"));
        xhr.open("POST", "/api/forge/upload"); xhr.send(fd);
      });
    },
    onMutate: (files) => { setState({ progress: 0, fileName: files.length === 1 ? files[0].name : `${files.length} files` }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["forge", "projects"] }); },
  });
  return { ...mutation, uploadState: state };
}

// ===========================================================================
// GitHub integration hooks
// ===========================================================================
export interface GitHubPR { number: number; url: string; title: string; head: string; base: string; state: string }
export interface GitHubWorkflowRun { id: number; name: string; displayTitle: string; status: string; conclusion: string | null; htmlUrl: string; branch: string; commitSha: string; event: string; startedAt: string | null; updatedAt: string | null }
export interface GitHubWorkflow { id: number; name: string; path: string; state: string }
export interface GitHubStatus { configured: boolean; owner?: string; repo?: string; canPush?: boolean; defaultBranch?: string | null; prs: GitHubPR[]; runs: GitHubWorkflowRun[]; workflows: GitHubWorkflow[] }

export function useGitHubStatus(projectId: string | null) {
  return useQuery({
    queryKey: ["forge", "github", "status", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/github/status`);
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      return (body.data ?? body) as GitHubStatus;
    },
    enabled: !!projectId,
    refetchInterval: (query) => { const data = query.state.data as GitHubStatus | undefined; return data?.configured ? 60_000 : false; },
  });
}
export function useRerunWorkflowRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { runId: number; failedOnly?: boolean }) => {
      const url = `/api/forge/projects/${projectId}/github/actions/runs/${vars.runId}/rerun${vars.failedOnly ? "?failed=true" : ""}`;
      const r = await fetch(url, { method: "POST" }); if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `Failed (${r.status})`); } return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] }),
  });
}
export function useCancelWorkflowRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: number) => {
      const r = await fetch(`/api/forge/projects/${projectId}/github/actions/runs/${runId}/cancel`, { method: "POST" }); if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `Failed (${r.status})`); } return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] }),
  });
}
export function useCreateBranch(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; base?: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/github/branch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vars) }); if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `Failed (${r.status})`); } return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] }),
  });
}
export function useCreatePR(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { title: string; head: string; body?: string; base?: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/github/pr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vars) }); if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `Failed (${r.status})`); } return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] }),
  });
}
export function useDispatchWorkflow(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { workflowId: number | string; ref: string; inputs?: Record<string, string> }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/github/dispatch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vars) }); if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `Failed (${r.status})`); } return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] }),
  });
}
