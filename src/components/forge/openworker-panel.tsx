"use client";
// ============================================================
// OpenWorkerPanel — connect Forge to an autonomous AI agent
// (OpenWorker coworker server) that works for the system.
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { Bot, Link2, Send, Loader2, CheckCircle2, XCircle } from "lucide-react";

const inp = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500";
const btn = "inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50";
const btn2 = "inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";

export function OpenWorkerPanel() {
  const [status, setStatus] = useState<any>(null);
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/forge/agent-worker"); setStatus(await r.json()); } catch (e) { setStatus({ error: String(e) }); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const connect = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await fetch("/api/forge/agent-worker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-url", url: url.trim() }) });
      setMsg("Saved. Checking connection…");
      await refresh();
    } finally { setBusy(false); }
  }, [url, refresh]);

  const dispatch = useCallback(async () => {
    if (!prompt.trim()) return;
    setBusy(true); setResult(null); setMsg(null);
    try {
      const r = await fetch("/api/forge/agent-worker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "task", prompt: prompt.trim() }) });
      setResult(await r.json());
    } finally { setBusy(false); }
  }, [prompt]);

  const connected = status?.connected === true;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-emerald-500" /> OpenWorker Agent
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect an <a className="underline" href="https://github.com/andrewyng/openworker" target="_blank" rel="noreferrer">OpenWorker</a> coworker
          server so an autonomous AI agent can work for Forge from within.
        </p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          {status == null ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : connected ? (
            <><CheckCircle2 className="size-4 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">Connected</span></>
          ) : (
            <><XCircle className="size-4 text-red-500" /><span className="text-muted-foreground">Not connected</span></>
          )}
          {status?.url && <span className="truncate text-xs text-muted-foreground">{status.url}</span>}
        </div>
        {status?.note && <p className="mt-2 text-xs text-muted-foreground">{status.note}</p>}
        {status?.error && <p className="mt-2 text-xs text-red-400">{status.error}</p>}
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="text-sm font-semibold">Coworker server URL</div>
        <div className="mt-2 flex gap-2">
          <input className={inp} placeholder="http://your-openworker-host:8000" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className={btn2} onClick={connect} disabled={busy}><Link2 className="size-4" />Connect</button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="text-sm font-semibold">Dispatch a task</div>
        <textarea className={inp + " mt-2 h-20 font-mono text-xs"} placeholder="e.g. Summarize the latest build run and draft a release note" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button className={btn + " mt-2"} onClick={dispatch} disabled={busy || !connected}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send to agent
        </button>
        {result && (
          <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-black/80 p-3 font-mono text-xs text-green-400 whitespace-pre-wrap">
            {result.reply ?? JSON.stringify(result, null, 2)}
          </pre>
        )}
        {!connected && <p className="mt-2 text-xs text-muted-foreground">Connect a coworker server to dispatch tasks.</p>}
      </div>
    </div>
  );
}
