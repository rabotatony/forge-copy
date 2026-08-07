"use client";

// ============================================================
// Forge — Terminal tab (web shell on the host)
// ============================================================
import { useCallback, useRef, useState } from "react";
import { Terminal as TermIcon, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Line { kind: "cmd" | "out" | "err"; text: string }

export function TerminalTab() {
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "Forge terminal — commands run on the host. On edge runtimes this is disabled." },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async () => {
    const c = cmd.trim();
    if (!c || busy) return;
    setBusy(true);
    setLines((l) => [...l, { kind: "cmd", text: "$ " + c }]);
    setCmd("");
    try {
      const r = await fetch("/api/forge/terminal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: c }),
      });
      const d = await r.json();
      if (d.stdout) setLines((l) => [...l, { kind: "out", text: d.stdout }]);
      if (d.stderr) setLines((l) => [...l, { kind: "err", text: d.stderr }]);
      if (d.error && !d.stderr) setLines((l) => [...l, { kind: "err", text: d.error }]);
    } catch (e) {
      setLines((l) => [...l, { kind: "err", text: String(e) }]);
    }
    setBusy(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [cmd, busy]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <TermIcon className="size-4" /> Web terminal — runs on the host (real compute)
      </div>
      <div className="flex gap-2">
        <Input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="e.g. uname -a  |  ls -la  |  node --version"
          className="font-mono text-sm"
        />
        <Button onClick={run} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run
        </Button>
      </div>
      <div className="max-h-96 overflow-auto rounded-md border border-border bg-black/90 p-3 font-mono text-xs text-green-400">
        {lines.map((l, i) => (
          <pre key={i} className={
            l.kind === "cmd" ? "text-cyan-300 whitespace-pre-wrap" :
            l.kind === "err" ? "text-red-400 whitespace-pre-wrap" : "whitespace-pre-wrap"
          }>{l.text}</pre>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
