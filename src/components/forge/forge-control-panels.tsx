"use client";
// ============================================================
// Forge Control Panels — frontend for the new capabilities
// ============================================================
// Each panel talks to a Forge API endpoint so the new backend powers
// (terminal, observer, sites, mesh, memory, telemetry, metrics,
// capabilities) are visible and usable in the UI.
// ============================================================
import { useCallback, useEffect, useState } from "react";

function Card(props: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-1 text-sm font-semibold text-foreground">{props.title}</div>
      {props.sub && <div className="mb-3 text-xs text-muted-foreground">{props.sub}</div>}
      {props.children}
    </div>
  );
}
const inp = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500";
const btn = "rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50";
const btn2 = "rounded-md border border-border px-3 py-2 text-sm hover:bg-muted";
const pre = "mt-3 max-h-72 overflow-auto rounded-md bg-black/80 p-3 font-mono text-xs text-green-400 whitespace-pre-wrap";

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ error: "bad response " + r.status }));
}
async function get(url: string) {
  const r = await fetch(url);
  return r.json().catch(() => ({ error: "bad response " + r.status }));
}

export function TerminalPanel() {
  const [cmd, setCmd] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (!cmd.trim()) return;
    setBusy(true); setRes(null);
    setRes(await post("/api/forge/terminal", { cmd }));
    setBusy(false);
  }, [cmd]);
  return (
    <Card title="Terminal" sub="Runs a shell command on local compute or an online mesh node.">
      <div className="flex gap-2">
        <input className={inp} value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="e.g. uname -a" />
        <button className={btn} onClick={run} disabled={busy}>{busy ? "…" : "Run"}</button>
      </div>
      {res && <pre className={pre}>{JSON.stringify(res, null, 2)}</pre>}
    </Card>
  );
}

export function ObserverPanel() {
  const [url, setUrl] = useState("https://forge.rabotatony.workers.dev/");
  const [mode, setMode] = useState("semantic");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true); setRes(null);
    setRes(await post("/api/forge/observe", { url, mode }));
    setBusy(false);
  }, [url, mode]);
  const o = res?.observation;
  return (
    <Card title="Observer" sub="The AI's eyes: headless-browser perception (aria, console, animations, videos). Needs an online mesh node with a browser.">
      <div className="flex gap-2">
        <input className={inp} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <select className={btn2} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="semantic">semantic</option>
          <option value="screenshot">screenshot</option>
          <option value="video">video</option>
        </select>
        <button className={btn} onClick={run} disabled={busy}>{busy ? "…" : "Observe"}</button>
      </div>
      {res && !o && <pre className={pre}>{JSON.stringify(res, null, 2)}</pre>}
      {o && (
        <div className="mt-3 space-y-3 text-sm">
          <div><b>title:</b> {o.dynamic?.title} · <b>animating:</b> {o.dynamic?.animatingElements} · <b>videos:</b> {o.dynamic?.videos?.length ?? 0}</div>
          {o.dynamic?.videos?.map((v: any, i: number) => <div key={i} className="text-xs text-muted-foreground">video: {v.src} playing={String(v.playing)} t={v.time}</div>)}
          {o.console?.length > 0 && <pre className={pre}>{o.console.join("\n")}</pre>}
          <div className="text-xs text-muted-foreground">Accessibility snapshot:</div>
          <pre className={pre}>{o.aria}</pre>
        </div>
      )}
    </Card>
  );
}

export function SitesPanel() {
  const [name, setName] = useState("my-site");
  const [html, setHtml] = useState("<!doctype html><h1>Hello from Forge</h1>");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const deploy = useCallback(async () => {
    setBusy(true); setRes(null);
    setRes(await post("/api/forge/sites", { name, files: { "index.html": html } }));
    setBusy(false);
  }, [name, html]);
  return (
    <Card title="Sites — deploy & get a unique link" sub="Stores your files and returns a unique public URL.">
      <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="site name" />
      <textarea className={inp + " mt-2 h-28 font-mono text-xs"} value={html} onChange={(e) => setHtml(e.target.value)} />
      <button className={btn + " mt-2"} onClick={deploy} disabled={busy}>{busy ? "…" : "Deploy"}</button>
      {res?.url && (
        <div className="mt-3 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3 text-sm">
          <div className="text-xs text-muted-foreground">Unique link:</div>
          <a href={res.url} target="_blank" rel="noreferrer" className="break-all text-emerald-400 underline">{res.url}</a>
        </div>
      )}
      {res?.error && <pre className={pre}>{JSON.stringify(res, null, 2)}</pre>}
    </Card>
  );
}

export function MeshPanel() {
  const [data, setData] = useState<any>(null);
  const load = useCallback(async () => setData(await get("/api/forge/mesh-build")), []);
  useEffect(() => { load(); }, [load]);
  return (
    <Card title="Mesh — distributed compute" sub="Online nodes that run terminal/builds/observer.">
      <button className={btn2} onClick={load}>Refresh</button>
      {data && (
        <div className="mt-3 text-sm">
          <div><b>online:</b> {data.mesh?.online ?? 0} / <b>total:</b> {data.mesh?.total ?? 0}</div>
          {(data.nodes ?? []).map((n: any) => (
            <div key={n.id} className="mt-1 rounded border border-border px-2 py-1 text-xs">
              <b>{n.slug}</b> · {n.kind} · <span className={n.status === "online" ? "text-emerald-400" : "text-muted-foreground"}>{n.status}</span>
            </div>
          ))}
          {(data.nodes ?? []).length === 0 && <div className="mt-2 text-xs text-muted-foreground">No nodes registered yet.</div>}
        </div>
      )}
    </Card>
  );
}

export function MemoryPanel() {
  const [mem, setMem] = useState<any>(null);
  const [key, setKey] = useState(""); const [val, setVal] = useState("");
  const load = useCallback(async () => setMem(await get("/api/forge/memory")), []);
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async () => { await post("/api/forge/memory", { set: { [key]: val } }); load(); }, [key, val, load]);
  return (
    <Card title="Memory — persistent state" sub="Long-term key/value memory (survives sessions).">
      <div className="flex gap-2">
        <input className={inp} placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} />
        <input className={inp} placeholder="value" value={val} onChange={(e) => setVal(e.target.value)} />
        <button className={btn} onClick={save}>Set</button>
      </div>
      {mem && <pre className={pre}>{JSON.stringify(mem.memory ?? {}, null, 2)}</pre>}
    </Card>
  );
}

export function TelemetryPanel() {
  const [data, setData] = useState<any>(null);
  const load = useCallback(async () => setData(await get("/api/forge/telemetry")), []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  return (
    <Card title="Telemetry — live UI state" sub="Auto-refreshes every 5s. Shows panel renders/crashes reported by the UI.">
      {data && <pre className={pre}>{JSON.stringify(data.events ?? [], null, 2)}</pre>}
    </Card>
  );
}

export function MetricsPanel() {
  const [data, setData] = useState<any>(null);
  const load = useCallback(async () => setData(await get("/api/forge/metrics")), []);
  useEffect(() => { load(); }, [load]);
  return (
    <Card title="Metrics — live health" sub="Projects, runs, mesh, uptime.">
      <button className={btn2} onClick={load}>Refresh</button>
      {data && <pre className={pre}>{JSON.stringify(data, null, 2)}</pre>}
    </Card>
  );
}

export function CapabilitiesPanel() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { get("/api/forge/capabilities").then(setData); }, []);
  return (
    <Card title="Capabilities — runtime self-report" sub="What this runtime can actually do.">
      {data && (
        <div className="text-sm">
          <div><b>filesystem:</b> {String(data.filesystem)} · <b>childProcess:</b> {String(data.childProcess)} · <b>localBuilds:</b> {String(data.localBuilds)}</div>
          <div className="mt-2 text-xs text-muted-foreground">{data.note}</div>
          {data.runtimes && <pre className={pre}>{JSON.stringify(data.runtimes, null, 2)}</pre>}
        </div>
      )}
    </Card>
  );
}
