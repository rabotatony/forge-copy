"use client";

// ============================================================
// Forge — Build Intelligence panel
// Zero-config capability analysis + one-click blueprint:
//   analyze → capability cards → apply blueprint actions.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  FileCode2,
  Loader2,
  PackageOpen,
  ScanSearch,
  Smartphone,
  Sparkles,
  Wand2,
  XCircle,
} from "lucide-react";

type Capability = { ok: boolean; blockers: string[]; warnings: string[] };

type Analysis = {
  framework: string;
  frameworkVersion: string | null;
  language: string;
  packageManager: string;
  packageName: string | null;
  appIdSuggestion: string;
  counts: { files: number; codeFiles: number; pages: number; apiRoutes: number };
  nextConfig: { exists: boolean; file: string | null; hasEnvToggle: boolean; imagesUnoptimized: boolean; standalone: boolean };
  capabilities: { staticExport: Capability; apkWrap: Capability; ssr: Capability };
  hasCapacitor: boolean;
  hasMiddleware: boolean;
  usesNextImage: boolean;
  recommendedTargets: string[];
  suggestions: string[];
};

type PreflightIssue = { level: "error" | "warning"; area: string; message: string; fix?: string };
type BlueprintChange = { action: string; file: string; status: string; reason?: string };

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as { ok: boolean; data: Record<string, unknown> };
}

const TARGET_LABELS: Record<string, string> = {
  "web-static": "Static site",
  "web-ssr": "SSR / Node app",
  "apk-android": "Android APK",
  "node-server": "Node service",
};

function CapabilityCard({ title, icon, cap }: { title: string; icon: React.ReactNode; cap: Capability }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </div>
        {cap.ok ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Ready
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
            <XCircle className="h-4 w-4" /> Blocked
          </span>
        )}
      </div>
      {cap.blockers.map((b, i) => (
        <p key={`b${i}`} className="text-xs text-red-600/90 dark:text-red-400/90 flex gap-1.5">
          <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {b}
        </p>
      ))}
      {(cap.warnings ?? []).map((w, i) => (
        <p key={`w${i}`} className="text-xs text-amber-600/90 dark:text-amber-400/90 flex gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
        </p>
      ))}
      {cap.ok && (cap.warnings ?? []).length === 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No blockers, no warnings.</p>
      )}
    </div>
  );
}

export function BuildIntelligencePanel({ projectId }: { projectId: string }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [preflight, setPreflight] = useState<PreflightIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [changes, setChanges] = useState<BlueprintChange[]>([]);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/forge/projects/${projectId}/analyze`);
      const body = await jsonOrThrow(res);
      const data = body.data as { analysis: Analysis; preflight: { apk: PreflightIssue[] } };
      setAnalysis(data.analysis);
      setPreflight(data.preflight?.apk ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void analyze(); }, [analyze]);

  const applyBlueprint = async (action: string) => {
    setBusyAction(action);
    setChanges([]);
    try {
      const res = await fetch(`/api/forge/projects/${projectId}/blueprint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await jsonOrThrow(res);
      const data = body.data as { changes: BlueprintChange[]; analysis: Analysis };
      setChanges(data.changes);
      await analyze();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  };

  if (loading && !analysis) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Analyzing project capabilities…
      </div>
    );
  }

  if (error && !analysis) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button onClick={() => void analyze()} className="text-xs underline">Retry</button>
      </div>
    );
  }

  if (!analysis) return null;

  const btn = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50";
  const primary = `${btn} bg-indigo-600 hover:bg-indigo-500 text-white border-transparent`;
  const ghost = `${btn} bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-800`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanSearch className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold">Build Intelligence</h3>
        </div>
        <button onClick={() => void analyze()} disabled={loading} className={ghost}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Re-analyze
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 font-medium capitalize">
          {analysis.framework}{analysis.frameworkVersion ? ` ${analysis.frameworkVersion}` : ""}
        </span>
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 capitalize">{analysis.language}</span>
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1">{analysis.packageManager}</span>
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1">{analysis.counts.codeFiles} code files</span>
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1">{analysis.counts.pages} pages</span>
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1">{analysis.counts.apiRoutes} API routes</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <CapabilityCard title="Static export" icon={<PackageOpen className="h-4 w-4 text-sky-500" />} cap={analysis.capabilities.staticExport} />
        <CapabilityCard title="APK wrap (offline app)" icon={<Smartphone className="h-4 w-4 text-emerald-500" />} cap={analysis.capabilities.apkWrap} />
        <CapabilityCard title="SSR / server" icon={<Boxes className="h-4 w-4 text-violet-500" />} cap={analysis.capabilities.ssr} />
      </div>

      {(analysis.recommendedTargets ?? []).length > 0 && (
        <div className="text-xs space-y-1.5">
          <p className="font-medium text-zinc-600 dark:text-zinc-300">Recommended targets</p>
          <div className="flex flex-wrap gap-1.5">
            {(analysis.recommendedTargets ?? []).map(t => (
              <span key={t} className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">
                {TARGET_LABELS[t] ?? t}
              </span>
            ))}
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {analysis.suggestions.map((s, i) => (
          <li key={i} className="text-xs text-zinc-600 dark:text-zinc-400 flex gap-1.5">
            <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" /> {s}
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-3 space-y-2">
        <p className="text-xs font-medium flex items-center gap-1.5">
          <Wand2 className="h-3.5 w-3.5 text-indigo-500" /> Blueprint — one click writes the config
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void applyBlueprint("export-mode")} disabled={busyAction !== null} className={ghost}>Export mode</button>
          <button onClick={() => void applyBlueprint("capacitor")} disabled={busyAction !== null} className={ghost}>Capacitor</button>
          <button onClick={() => void applyBlueprint("apk-workflow")} disabled={busyAction !== null} className={ghost}>APK workflow</button>
          <button onClick={() => void applyBlueprint("all")} disabled={busyAction !== null} className={primary}>
            {busyAction === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Apply everything
          </button>
        </div>
        {changes.length > 0 && (
          <ul className="space-y-1 pt-1">
            {changes.map((c, i) => (
              <li key={i} className="text-xs flex items-center gap-1.5">
                <FileCode2 className="h-3.5 w-3.5 text-zinc-400" />
                <span className={c.status === "skipped" ? "text-zinc-400" : "text-emerald-600 dark:text-emerald-400"}>{c.file}</span>
                <span className="text-zinc-500">— {c.status}{c.reason ? ` (${c.reason})` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preflight.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">APK pre-flight</p>
          {preflight.map((p, i) => (
            <p key={i} className={`text-xs flex gap-1.5 ${p.level === "error" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
              {p.level === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              [{p.area}] {p.message}{p.fix ? ` — fix: ${p.fix}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
