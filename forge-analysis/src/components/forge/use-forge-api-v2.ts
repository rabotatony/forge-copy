"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const QK = ["forge"] as const;

async function jsonOrThrow(r: Response): Promise<unknown> {
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((e as { error?: string }).error ?? "Request failed");
  }
  return r.json();
}

// =========================================================================
// Secrets
// =========================================================================
export function useSecrets(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "secrets", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/secrets`);
      return jsonOrThrow(r) as Promise<{ secrets: Array<{ id: string; key: string; createdAt: string; updatedAt: string }> }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "secrets", projectId] }),
  });
}

export function useDeleteSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/secrets/${encodeURIComponent(key)}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "secrets", projectId] }),
  });
}

// =========================================================================
// Env Vars
// =========================================================================
export function useEnvVars(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "env-vars", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/env-vars`);
      return jsonOrThrow(r) as Promise<{ envVars: Array<{ id: string; key: string; value: string }> }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "env-vars", projectId] }),
  });
}

export function useDeleteEnvVar(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/env-vars/${encodeURIComponent(key)}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "env-vars", projectId] }),
  });
}

// =========================================================================
// Cache
// =========================================================================
export function useCacheEntries(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "cache", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/cache`);
      return jsonOrThrow(r) as Promise<{ entries: Array<{ id: string; key: string; label: string; size: number; createdAt: string; lastUsedAt: string; hitCount: number }> }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "cache", projectId] }),
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
      return jsonOrThrow(r) as Promise<{ removed: number }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "cache", projectId] }),
  });
}

// =========================================================================
// Triggers
// =========================================================================
export function useTriggers(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "triggers", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/triggers`);
      return jsonOrThrow(r) as Promise<{ triggers: Array<{ id: string; type: string; workflow: string; config: string; enabled: boolean; lastFiredAt: string | null; deliveries?: unknown[] }> }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "triggers", projectId] }),
  });
}

export function useDeleteTrigger(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (triggerId: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/triggers/${triggerId}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "triggers", projectId] }),
  });
}

// =========================================================================
// Notifications
// =========================================================================
export function useNotifications(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "notifications", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/notifications`);
      return jsonOrThrow(r) as Promise<{ notifications: Array<{ id: string; event: string; url: string; enabled: boolean; createdAt: string }> }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "notifications", projectId] }),
  });
}

export function useDeleteNotification(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/notifications/${notificationId}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "notifications", projectId] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "notifications", projectId] }),
  });
}

// =========================================================================
// Pipelines
// =========================================================================
export function usePipelines(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "pipelines", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/pipelines`);
      return jsonOrThrow(r) as Promise<{ pipelines: Array<{ id: string; name: string; stages: string; createdAt: string }> }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "pipelines", projectId] }),
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pipelineId: string) => {
      const r = await fetch(`/api/forge/pipelines/${pipelineId}`, { method: "DELETE" });
      return jsonOrThrow(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
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
      return jsonOrThrow(r) as Promise<{ pipelineRunId: string }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function usePipelineRun(pipelineRunId: string | null) {
  return useQuery({
    queryKey: [...QK, "pipeline-run", pipelineRunId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/pipelines/runs/${pipelineRunId}`);
      return jsonOrThrow(r);
    },
    enabled: !!pipelineRunId,
    refetchInterval: 2000,
  });
}

// =========================================================================
// Analytics
// =========================================================================
export function useAnalyticsOverview(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "analytics", "overview", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/analytics/overview`);
      return jsonOrThrow(r) as Promise<{
        totalRuns: number;
        successRate: number;
        avgDurationMs: number;
        activeRuns: number;
        runsByWorkflow: Array<{ workflow: string; count: number; successRate: number }>;
        runsByStatus: Record<string, number>;
        recentRuns: Array<{ id: string; workflow: string; status: string; startedAt: string; durationMs: number | null }>;
        topFailures: Array<{ workflow: string; totalRuns: number; failedRuns: number; failureRate: number; sampleErrors: string[] }>;
      }>;
    },
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function usePerformanceTrends(projectId: string | null, workflow: string) {
  return useQuery({
    queryKey: [...QK, "analytics", "trends", projectId, workflow],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/analytics/trends?workflow=${encodeURIComponent(workflow)}&limit=50`);
      return jsonOrThrow(r) as Promise<{ trends: Array<{ runId: string; startedAt: string; durationMs: number | null; status: string; exitCode: number | null }> }>;
    },
    enabled: !!projectId && !!workflow,
  });
}

export function useFailurePatterns(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "analytics", "failures", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/analytics/failures`);
      return jsonOrThrow(r) as Promise<{ patterns: Array<{ workflow: string; totalRuns: number; failedRuns: number; failureRate: number; lastFailedAt: string | null; sampleErrors: string[] }> }>;
    },
    enabled: !!projectId,
  });
}

// =========================================================================
// Log Search
// =========================================================================
export function useLogSearch(runId: string | null, query: string, options?: { stream?: string; caseSensitive?: boolean; useRegex?: boolean }) {
  return useQuery({
    queryKey: [...QK, "log-search", runId, query, options],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      if (options?.stream) params.set("stream", options.stream);
      if (options?.caseSensitive) params.set("caseSensitive", "true");
      if (options?.useRegex) params.set("useRegex", "true");
      const r = await fetch(`/api/forge/runs/${runId}/logs/search?${params}`);
      return jsonOrThrow(r) as Promise<{ hits: Array<{ seq: number; stream: string; text: string; ts: string }>; count: number }>;
    },
    enabled: !!runId && query.length > 0,
  });
}

// =========================================================================
// Test Report
// =========================================================================
export function useTestReport(runId: string | null) {
  return useQuery({
    queryKey: [...QK, "test-report", runId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/runs/${runId}/test-report`);
      return jsonOrThrow(r) as Promise<{ found: boolean; report?: unknown }>;
    },
    enabled: !!runId,
  });
}

// =========================================================================
// Approval
// =========================================================================
export function useApproval(runId: string | null) {
  return useQuery({
    queryKey: [...QK, "approval", runId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/runs/${runId}/approval`);
      return jsonOrThrow(r) as Promise<{
        required: boolean;
        status?: string;
        requestedAt?: string;
        decidedAt?: string | null;
        decidedBy?: string | null;
        reason?: string | null;
      }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "approval", runId] }),
  });
}

// =========================================================================
// Custom Workflows
// =========================================================================
export function useCustomWorkflows(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "custom-workflows", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/custom-workflows`);
      return jsonOrThrow(r) as Promise<{ customWorkflows: Array<{ id: string; name: string; workflow: unknown; createdAt: string }> }>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "custom-workflows", projectId] }),
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
      return jsonOrThrow(r) as Promise<{ valid: boolean; errors: string[] }>;
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
      return jsonOrThrow(r) as Promise<{ runId: string }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

// =========================================================================
// Workflow Catalog
// =========================================================================
export function useWorkflowCatalog(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "workflow-catalog", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/workflows`);
      return jsonOrThrow(r) as Promise<{ workflows: Array<{ key: string; name: string; description: string; icon: string; requiresApproval: boolean; secrets: string[]; cache: unknown; testReport: unknown }> }>;
    },
    enabled: !!projectId,
  });
}

// =========================================================================
// Settings
// =========================================================================
export function useProjectSettings(projectId: string | null) {
  return useQuery({
    queryKey: [...QK, "settings", projectId],
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
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QK, "settings", projectId] }),
  });
}
