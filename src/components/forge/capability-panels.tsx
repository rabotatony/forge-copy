"use client";
// ============================================================
// Capability Panels — distinct, purposeful UI for capabilities that
// previously had only a backend. Each panel is designed for its job
// (not a generic JSON dump), so nothing is a duplicate.
// ============================================================
import { useCallback, useEffect, useState } from "react";

const inp = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500";
const btn = "rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50";
const btn2 = "rounded-md border border-border px-3 py-2 text-sm hover:bg-muted";
const card = "rounded-lg border border-border bg-card/40 p-4";
const tbl = "w-full text-left text-xs";

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ---- Stats: at-a-glance numbers -------------------------------------------
export function StatsPanel() {
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/forge/stats"); setD(await r.json().catch(() => null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const rate = d?.successRate;
  const rateStr = rate === undefined || rate === null ? "–" : `${Math.round(rate <= 1 && d?.totalRuns > 0 ? rate * 100 : rate)}%`;
  const Cell = ({ label, value }: { label: string; value: any }) => (
    <div className="rounded-lg border border-border bg-background/40 p-4 text-center">
      <div className="text-2xl font-bold text-emerald-500">{value ?? "–"}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return (
    <div className={card}>
      <Head title="Overview" sub="Live counts across Forge." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell label="Projects" value={d?.projects} />
        <Cell label="Total runs" value={d?.totalRuns} />
        <Cell label="Success rate" value={rateStr} />
        <Cell label="Running now" value={d?.runningCount} />
      </div>
    </div>
  );
}

// ---- Audit log: who did what ----------------------------------------------
export function AuditLogPanel() {
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/forge/audit-log?limit=30"); setD(await r.json().catch(() => null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const rows = d?.entries ?? d?.logs ?? d?.items ?? [];
  return (
    <div className={card}>
      <Head title="Audit Log" sub="Recent actions recorded by Forge." />
      <button className={btn2} onClick={load}>Refresh</button>
      {rows.length === 0 && <div className="mt-3 text-xs text-muted-foreground">No audit entries yet.</div>}
      {rows.length > 0 && (
        <table className={tbl + " mt-3"}>
          <thead><tr className="text-muted-foreground"><th className="py-1 pr-3">When</th><th className="py-1 pr-3">Action</th><th className="py-1">Detail</th></tr></thead>
          <tbody>
            {rows.slice(0, 30).map((e: any, i: number) => (
              <tr key={i} className="border-t border-border/50">
                <td className="py-1 pr-3 text-muted-foreground">{new Date(e.createdAt ?? e.at ?? Date.now()).toLocaleTimeString()}</td>
                <td className="py-1 pr-3">{e.action ?? e.event ?? e.type ?? "–"}</td>
                <td className="py-1 text-muted-foreground">{String(e.details ?? e.detail ?? e.message ?? e.target ?? "").slice(0, 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Scheduler: timed jobs -------------------------------------------------
export function SchedulerPanel() {
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/forge/scheduler"); setD(await r.json().catch(() => null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const jobs = d?.jobs ?? []; const templates = d?.templates ?? {};
  const remove = useCallback(async (id: string) => {
    await fetch("/api/forge/scheduler", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }, [load]);
  return (
    <div className={card}>
      <Head title="Scheduler" sub="Timed / recurring jobs." />
      <button className={btn2} onClick={load}>Refresh</button>
      {jobs.length === 0 && <div className="mt-3 text-xs text-muted-foreground">No scheduled jobs. Templates available: {Object.keys(templates).join(", ") || "none"}.</div>}
      {jobs.map((j: any) => (
        <div key={j.id} className="mt-2 flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
          <span><b>{j.id}</b> · every {j.interval ?? j.every ?? "?"}</span>
          <button className="text-red-400 hover:underline" onClick={() => remove(j.id)}>remove</button>
        </div>
      ))}
    </div>
  );
}

// ---- Search: global finder -------------------------------------------------
export function SearchPanel() {
  const [q, setQ] = useState("");
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const go = useCallback(async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    const r = await fetch("/api/forge/search?q=" + encodeURIComponent(q));
    setD(await r.json().catch(() => null)); setBusy(false);
  }, [q]);
  const results = d?.results ?? [];
  return (
    <div className={card}>
      <Head title="Search" sub="Find projects, runs, workflows, logs." />
      <div className="flex gap-2">
        <input className={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="type at least 2 chars…" />
        <button className={btn} onClick={go} disabled={busy}>{busy ? "…" : "Search"}</button>
      </div>
      {results.length > 0 && (
        <div className="mt-3 space-y-1">
          {results.slice(0, 20).map((r: any, i: number) => (
            <div key={i} className="rounded border border-border px-2 py-1 text-xs">
              <b>{r.title ?? r.name ?? r.label ?? "result"}</b> <span className="text-muted-foreground">· {r.type ?? r.kind ?? ""}</span>
            </div>
          ))}
        </div>
      )}
      {d && results.length === 0 && <div className="mt-3 text-xs text-muted-foreground">No results for “{d.query}”.</div>}
    </div>
  );
}

// ---- AI Audit: detect AI-generated content ---------------------------------
export function AIAuditPanel() {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => { fetch("/api/forge/ai-audit").then((r) => r.json()).then(setInfo).catch(() => {}); }, []);
  return (
    <div className={card}>
      <Head title="AI Audit" sub="Detects AI-generated content in uploaded projects." />
      {info ? (
        <div className="text-sm">
          <div className="text-xs text-muted-foreground">{info.description}</div>
          <div className="mt-2 text-xs">Detectors: {(info.detectors ?? []).join(", ")}</div>
          <div className="mt-2 text-xs text-muted-foreground">Usage: {info.usage}</div>
        </div>
      ) : <div className="text-xs text-muted-foreground">Loading…</div>}
    </div>
  );
}
