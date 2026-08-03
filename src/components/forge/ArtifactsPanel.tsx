"use client";

// ============================================================
// Forge — ArtifactsPanel (Phase B)
// ============================================================
// Project artifacts with provenance + distribution:
//   • list registered artifacts (kind / size / version / sha256)
//   • one-click import from GitHub Actions artifacts
//   • import from URL (SSRF-guarded server side)
//   • download / QR install / publish to GitHub Release / delete
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package,
  Download,
  QrCode,
  Rocket,
  Trash2,
  RefreshCw,
  Github,
  Link2,
  Loader2,
  X,
  Smartphone,
  ExternalLink,
} from "lucide-react";

type Artifact = {
  id: string;
  name: string;
  kind: string;
  size: number;
  mime: string;
  version: string | null;
  source: string;
  sha256: string | null;
  createdAt: string;
};

type WorkflowArtifact = {
  apiId: number;
  name: string;
  sizeInBytes: number;
  workflowRunId: number;
  createdAt: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: string }
    | null;
  if (!res.ok || json?.ok === false) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return (json?.data ?? json) as T;
}

function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const KIND_BADGE: Record<string, string> = {
  apk: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  zip: "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-400",
  archive: "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-400",
  binary: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  file: "border-zinc-500/30 bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

const BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

export function ArtifactsPanel({ projectId }: { projectId: string }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowArtifact[] | null>(null);
  const [workflowRepo, setWorkflowRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState<{ artifact: Artifact; src: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const base = `/api/forge/projects/${projectId}/artifacts`;

  const refresh = useCallback(async () => {
    try {
      const rows = await api<Artifact[]>(base);
      setArtifacts(Array.isArray(rows) ? rows : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 10000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 8000);
  };

  const loadWorkflow = async () => {
    setBusy("workflow");
    setError(null);
    try {
      const res = await api<{ projectRepo: string | null; artifacts: WorkflowArtifact[] }>(
        `${base}?source=workflow`,
      );
      setWorkflowRepo(res.projectRepo);
      setWorkflow(res.artifacts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkflow(null);
    } finally {
      setBusy(null);
    }
  };

  const importWorkflow = async (wa: WorkflowArtifact) => {
    setBusy(`import-${wa.apiId}`);
    setError(null);
    try {
      const res = await api<{ artifactId: string; name: string; extractedFrom?: string }>(base, {
        method: "POST",
        body: JSON.stringify({ mode: "workflow", artifactApiId: wa.apiId, name: wa.name }),
      });
      flash(
        res.extractedFrom
          ? `Imported "${res.name}" (extracted from workflow artifact "${res.extractedFrom}")`
          : `Imported "${res.name}"`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importUrl = async () => {
    if (!url.trim()) return;
    setBusy("url");
    setError(null);
    try {
      const res = await api<{ artifactId: string; name: string }>(base, {
        method: "POST",
        body: JSON.stringify({ mode: "url", url: url.trim() }),
      });
      flash(`Imported "${res.name}" from URL`);
      setUrl("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const publish = async (a: Artifact) => {
    setBusy(`publish-${a.id}`);
    setError(null);
    try {
      const res = await api<{ releaseUrl: string; assetUrl: string }>(
        `${base}/${a.id}/publish`,
        { method: "POST" },
      );
      flash(`Published "${a.name}" → GitHub Release`);
      setNotice(`Published! Download URL: ${res.assetUrl}`);
      setTimeout(() => setNotice(null), 15000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (a: Artifact) => {
    if (!confirm(`Delete artifact "${a.name}"?`)) return;
    setBusy(`delete-${a.id}`);
    setError(null);
    try {
      await api(`${base}/${a.id}`, { method: "DELETE" });
      flash(`Deleted "${a.name}"`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openQr = (a: Artifact) => {
    setQr({ artifact: a, src: `${base}/${a.id}/qr?t=${Date.now()}` });
  };

  return (
    <section className="rounded-xl border bg-card text-card-foreground shadow-sm">
      {/* header */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Artifacts</h3>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {artifacts.length}
          </span>
        </div>
        <button className={BTN} onClick={refresh} title="Refresh">
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        </button>
      </header>

      {/* banners */}
      {error && (
        <div className="mx-4 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="mx-4 mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400 break-all">
          {notice}
        </div>
      )}

      {/* import toolbar */}
      <div className="space-y-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className={BTN} onClick={loadWorkflow} disabled={busy !== null}>
            {busy === "workflow" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Github className="h-3.5 w-3.5" />
            )}
            Load from GitHub Actions
          </button>
          <div className="flex min-w-[240px] flex-1 items-center gap-2">
            <input
              className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs shadow-sm outline-none focus:ring-1 focus:ring-ring"
              placeholder="https://example.com/app-release.apk"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && importUrl()}
            />
            <button className={BTN} onClick={importUrl} disabled={busy !== null || !url.trim()}>
              {busy === "url" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Import URL
            </button>
          </div>
        </div>

        {workflow !== null && (
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium">
                GitHub Actions artifacts{" "}
                {workflowRepo && <span className="text-muted-foreground">({workflowRepo})</span>}
              </span>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setWorkflow(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {workflow.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No unexpired artifacts found for this project&apos;s repository.
              </p>
            ) : (
              <ul className="max-h-56 divide-y overflow-y-auto">
                {workflow.map((wa) => (
                  <li key={wa.apiId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{wa.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtSize(wa.sizeInBytes)} · run #{wa.workflowRunId} · {fmtDate(wa.createdAt)}
                      </p>
                    </div>
                    <button
                      className={BTN}
                      onClick={() => importWorkflow(wa)}
                      disabled={busy !== null}
                    >
                      {busy === `import-${wa.apiId}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Import
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* artifact list */}
      {artifacts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Package className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No artifacts yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Import a GitHub Actions artifact (like your APK build) or paste a direct download URL.
            Forge stores it, hashes it, and can distribute it via QR or GitHub Releases.
          </p>
        </div>
      ) : (
        <ul className="divide-y">
          {artifacts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">{a.name}</span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                      KIND_BADGE[a.kind] ?? KIND_BADGE.file
                    }`}
                  >
                    {a.kind}
                  </span>
                  {a.version && (
                    <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {a.version}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {fmtSize(a.size)} · via {a.source} · {fmtDate(a.createdAt)}
                  {a.sha256 && ` · sha256:${a.sha256.slice(0, 10)}…`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  className={BTN}
                  href={`${base}/${a.id}/download`}
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button className={BTN} onClick={() => openQr(a)} title="QR install">
                  <QrCode className="h-3.5 w-3.5" />
                </button>
                <button
                  className={BTN}
                  onClick={() => publish(a)}
                  disabled={busy !== null}
                  title="Publish to GitHub Release"
                >
                  {busy === `publish-${a.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  className={`${BTN} hover:border-red-500/40 hover:text-red-500`}
                  onClick={() => remove(a)}
                  disabled={busy !== null}
                  title="Delete"
                >
                  {busy === `delete-${a.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* QR modal */}
      {qr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setQr(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">Scan to install</h4>
              </div>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setQr(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex justify-center rounded-lg border bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.src} alt={`QR for ${qr.artifact.name}`} className="h-56 w-56" />
            </div>
            <p className="mt-3 truncate text-center text-xs text-muted-foreground">{qr.artifact.name}</p>
            <a
              className={`${BTN} mt-3 w-full justify-center`}
              href={`${base}/${qr.artifact.id}/download`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open download link
            </a>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              QR points at this Forge node. If the node is on your LAN/tunnel, scan from a device
              that can reach it.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
