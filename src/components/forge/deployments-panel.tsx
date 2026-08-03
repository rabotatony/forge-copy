'use client';

// ============================================================
// Forge — Deployments panel
// ============================================================
// Self-hosted Netlify/Vercel-style deployments: environments,
// one-click publish, live URL, version history and rollback.
// Mount inside a project workspace tab:
//   <DeploymentsPanel projectId={project.id} />
// ============================================================

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type DeployStatus = 'pending' | 'in_progress' | 'success' | 'failed' | 'canceled';

interface DeploymentRow {
  id: string;
  environmentId: string;
  runId: string | null;
  status: DeployStatus;
  version: string | null;
  deployedAt: string | null;
  deployedBy: string | null;
  rollbackOfId: string | null;
  createdAt: string;
  environment?: { id: string; name: string };
}

interface EnvironmentRow {
  id: string;
  name: string;
  description: string | null;
  requiresApproval: boolean;
  requiredReviewers: number;
  url: string | null;
  deployments: DeploymentRow[];
}

async function jsonOrThrow(res: Response): Promise<any> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) {
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
  return j.data ?? j;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_STYLE: Record<DeployStatus, string> = {
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  in_progress: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 animate-pulse',
  pending: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  canceled: 'bg-slate-500/15 text-slate-500',
};

const STATUS_LABEL: Record<DeployStatus, string> = {
  success: 'Live',
  failed: 'Failed',
  in_progress: 'Deploying…',
  pending: 'Pending',
  canceled: 'Canceled',
};

function StatusBadge({ status }: { status: DeployStatus }) {
  return (
    <Badge className={`${STATUS_STYLE[status] ?? ''} border-0 font-medium`}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const inputCls =
  'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none ' +
  'focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 ' +
  'dark:bg-slate-900 dark:focus:ring-slate-800';

export function DeploymentsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['forge', 'environments', projectId] });
    void qc.invalidateQueries({ queryKey: ['forge', 'deployments', projectId] });
  };

  const envsQuery = useQuery<EnvironmentRow[]>({
    queryKey: ['forge', 'environments', projectId],
    queryFn: async () =>
      jsonOrThrow(await fetch(`/api/forge/projects/${projectId}/environments`)),
    refetchInterval: 5000,
  });

  const depsQuery = useQuery<DeploymentRow[]>({
    queryKey: ['forge', 'deployments', projectId],
    queryFn: async () =>
      jsonOrThrow(await fetch(`/api/forge/projects/${projectId}/deployments`)),
    refetchInterval: 5000,
  });

  const envs = envsQuery.data ?? [];
  const deployments = depsQuery.data ?? [];

  const [envId, setEnvId] = React.useState('');
  const [outputDir, setOutputDir] = React.useState('');
  const [source, setSource] = React.useState<'workspace' | 'run'>('workspace');
  const [runId, setRunId] = React.useState('');
  const [newEnvName, setNewEnvName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!envId && envs.length > 0) setEnvId(envs[0].id);
  }, [envs, envId]);

  const deployMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      jsonOrThrow(
        await fetch(`/api/forge/projects/${projectId}/deployments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const rollbackMut = useMutation({
    mutationFn: async (deploymentId: string) =>
      jsonOrThrow(
        await fetch(`/api/forge/deployments/${deploymentId}/rollback`, { method: 'POST' }),
      ),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const envMut = useMutation({
    mutationFn: async (name: string) =>
      jsonOrThrow(
        await fetch(`/api/forge/projects/${projectId}/environments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      ),
    onSuccess: () => {
      setNewEnvName('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const busy = deployMut.isPending || rollbackMut.isPending || envMut.isPending;

  return (
    <div className="space-y-6">
      {/* ---------- Environments ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Environments</h3>
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} w-40`}
              placeholder="new-env-name"
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !newEnvName.trim()}
              onClick={() => envMut.mutate(newEnvName.trim().toLowerCase())}
            >
              Add
            </Button>
          </div>
        </div>

        {envs.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
            <span>No environments yet. Start with the classics:</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => envMut.mutate('production')}>
                + production
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => envMut.mutate('staging')}>
                + staging
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {envs.map((env) => {
              const latest = env.deployments[0];
              return (
                <div key={env.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{env.name}</span>
                    {latest ? <StatusBadge status={latest.status} /> : null}
                  </div>
                  {env.url ? (
                    <a
                      href={env.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {env.url} ↗
                    </a>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">
                      Not deployed yet (set FORGE_DOMAIN for public URLs)
                    </p>
                  )}
                  {env.requiresApproval ? (
                    <p className="mt-1 text-xs text-amber-600">Requires approval</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- Deploy form ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h3 className="mb-3 text-sm font-semibold">Deploy now</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Environment
            <select className={inputCls} value={envId} onChange={(e) => setEnvId(e.target.value)}>
              {envs.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Source
            <select
              className={inputCls}
              value={source}
              onChange={(e) => setSource(e.target.value as 'workspace' | 'run')}
            >
              <option value="workspace">Project workspace</option>
              <option value="run">Run artifacts</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Output dir (optional)
            <input
              className={inputCls}
              placeholder="dist / out / build"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
            />
          </label>
          {source === 'run' ? (
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Run ID
              <input
                className={inputCls}
                placeholder="run id"
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              />
            </label>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button
            disabled={busy || !envId || (source === 'run' && !runId.trim())}
            onClick={() => {
              setError(null);
              deployMut.mutate({
                environmentId: envId,
                source,
                runId: source === 'run' ? runId.trim() : undefined,
                outputDir: outputDir.trim() || undefined,
              });
            }}
          >
            {deployMut.isPending ? 'Deploying…' : '🚀 Deploy'}
          </Button>
          {error ? <span className="text-xs text-red-500">{error}</span> : null}
        </div>
      </section>

      {/* ---------- History ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h3 className="border-b border-slate-200 p-4 text-sm font-semibold dark:border-slate-800">
          Deploy history
        </h3>
        {deployments.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No deployments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                  <th className="px-4 py-2 font-medium">Environment</th>
                  <th className="px-4 py-2 font-medium">Version</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">By</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 last:border-0 dark:border-slate-900">
                    <td className="px-4 py-2">{d.environment?.name ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {d.version ?? '—'}
                      {d.rollbackOfId ? (
                        <span className="ml-2 text-[10px] text-amber-500">rollback</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {timeAgo(d.deployedAt ?? d.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{d.deployedBy ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || d.status !== 'success' || !d.version}
                        onClick={() => rollbackMut.mutate(d.id)}
                      >
                        Rollback
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
