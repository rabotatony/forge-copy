"use client";

// ============================================================
// Forge — Deployments panel
// Publish static sites or Node apps (Netlify/Vercel replacement):
//   - environments cards with live URL / service state
//   - publish form (target kind, source, outputDir, hosts)
//   - history with rollback + service start/stop/restart
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  Globe,
  History,
  Loader2,
  Play,
  Rocket,
  RotateCcw,
  Server,
  Square,
} from "lucide-react";

type Environment = {
  id: string;
  name: string;
  description?: string | null;
  url?: string | null;
};

type Deployment = {
  id: string;
  status: string;
  version?: string | null;
  deployedAt?: string | null;
  deployedBy?: string | null;
  environment?: { id: string; name: string };
};

type ServiceStatus = {
  serviceName: string;
  port: number;
  unitInstalled: boolean;
  activeState?: string;
  subState?: string;
};

export function DeploymentsPanel({ projectId }: { projectId: string }) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [service, setService] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // publish form state
  const [environmentId, setEnvironmentId] = useState("");
  const [kind, setKind] = useState<"static" | "node">("static");
  const [source, setSource] = useState<"workspace" | "run">("workspace");
  const [outputDir, setOutputDir] = useState("");
  const [startCommand, setStartCommand] = useState("node server.js");
  const [hosts, setHosts] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [envRes, depRes, svcRes] = await Promise.all([
        fetch(`/api/forge/projects/${projectId}/environments`),
        fetch(`/api/forge/projects/${projectId}/deployments`),
        fetch(`/api/forge/projects/${projectId}/service`),
      ]);
      if (envRes.ok) {
        const envs = (await envRes.json()) as Environment[];
        setEnvironments(Array.isArray(envs) ? envs : []);
        setEnvironmentId((cur) => cur || (Array.isArray(envs) && envs[0] ? envs[0].id : ""));
      }
      if (depRes.ok) {
        const deps = (await depRes.json()) as Deployment[];
        setDeployments(Array.isArray(deps) ? deps : []);
      }
      if (svcRes.ok) setService((await svcRes.json()) as ServiceStatus);
    } catch {
      // transient network errors are fine; next poll will retry
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function publish() {
    if (!environmentId) {
      setMessage({ ok: false, text: "בחר סביבה קודם" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/forge/projects/${projectId}/deployments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentId,
          source,
          outputDir: outputDir || undefined,
          kind,
          startCommand: kind === "node" ? startCommand : undefined,
          hosts:
            kind === "node" && hosts.trim()
              ? hosts.split(",").map((h) => h.trim()).filter(Boolean)
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: data?.error || `שגיאה ${res.status}` });
      } else {
        const urlText = data.url ? ` → ${data.url}` : "";
        const svcText =
          kind === "node" && data.service && !data.service.ok
            ? " (השירות דורש הפעלה ידנית — ראה פלט ה-API)"
            : "";
        setMessage({ ok: true, text: `פורסם ${data.version}${urlText}${svcText}` });
        load();
      }
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function rollback(deploymentId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/forge/deployments/${deploymentId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) setMessage({ ok: false, text: data?.error || `שגיאה ${res.status}` });
      else setMessage({ ok: true, text: `בוצע rollback לגרסה ${data.version}` });
      load();
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function serviceAction(action: "start" | "stop" | "restart") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/forge/projects/${projectId}/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) setMessage({ ok: false, text: data?.error || `שגיאה ${res.status}` });
      else if (!data.ok)
        setMessage({ ok: false, text: "אין הרשאת systemctl — הרץ את הפקודות הידניות מהתגובה" });
      else setMessage({ ok: true, text: `${action} בוצע עבור ${data.serviceName}` });
      load();
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }

  const serviceActive = service?.activeState === "active";

  return (
    <div className="space-y-6">
      {/* ---------- environments ---------- */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4" /> סביבות
        </h3>
        {environments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            אין סביבות עדיין — צור סביבה דרך ה-API או הוסף production/staging.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {environments.map((env) => (
              <div key={env.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{env.name}</span>
                  {service?.unitInstalled && (
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs " +
                        (serviceActive
                          ? "bg-green-500/15 text-green-600"
                          : "bg-zinc-500/15 text-zinc-500")
                      }
                    >
                      {serviceActive ? "active" : service?.activeState ?? "inactive"}
                    </span>
                  )}
                </div>
                {env.url ? (
                  <a
                    href={env.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-sm text-blue-500 hover:underline"
                    dir="ltr"
                  >
                    {env.url}
                  </a>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">עדיין לא פורסם</p>
                )}
                {service?.unitInstalled && (
                  <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                    {service.serviceName} · port {service.port}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- publish form ---------- */}
      <section className="rounded-lg border p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Rocket className="h-4 w-4" /> פרסום חדש
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">סביבה</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5"
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">סוג יעד</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5"
              value={kind}
              onChange={(e) => setKind(e.target.value as "static" | "node")}
            >
              <option value="static">Static site (קבצים)</option>
              <option value="node">Node app (Next standalone וכד׳)</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">מקור</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5"
              value={source}
              onChange={(e) => setSource(e.target.value as "workspace" | "run")}
            >
              <option value="workspace">Workspace של הפרויקט</option>
              <option value="run">Artifacts של הרצה</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              outputDir {kind === "node" ? "(למשל .next/standalone)" : "(למשל dist)"}
            </span>
            <input
              className="w-full rounded-md border bg-background px-2 py-1.5"
              dir="ltr"
              placeholder="(root)"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
            />
          </label>

          {kind === "node" && (
            <>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">פקודת הפעלה</span>
                <input
                  className="w-full rounded-md border bg-background px-2 py-1.5"
                  dir="ltr"
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">
                  דומיינים (מופרדים בפסיק) — למשל shoshana.app, www.shoshana.app
                </span>
                <input
                  className="w-full rounded-md border bg-background px-2 py-1.5"
                  dir="ltr"
                  placeholder="(אוטומטית: slug.FORGE_DOMAIN)"
                  value={hosts}
                  onChange={(e) => setHosts(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={publish}
            disabled={busy || !environmentId}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            פרסם עכשיו
          </button>
          {kind === "node" && service?.unitInstalled && (
            <>
              <button
                onClick={() => serviceAction("restart")}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> restart
              </button>
              {serviceActive ? (
                <button
                  onClick={() => serviceAction("stop")}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                >
                  <Square className="h-3.5 w-3.5" /> stop
                </button>
              ) : (
                <button
                  onClick={() => serviceAction("start")}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" /> start
                </button>
              )}
            </>
          )}
          {message && (
            <span className={"text-sm " + (message.ok ? "text-green-600" : "text-red-600")}>
              {message.text}
            </span>
          )}
        </div>
      </section>

      {/* ---------- history ---------- */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" /> היסטוריית דיפלויים
        </h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">טוען…</p>
        ) : deployments.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין דיפלויים עדיין.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-right">
                <tr>
                  <th className="px-3 py-2 font-medium">גרסה</th>
                  <th className="px-3 py-2 font-medium">סביבה</th>
                  <th className="px-3 py-2 font-medium">סטטוס</th>
                  <th className="px-3 py-2 font-medium">זמן</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((dep) => (
                  <tr key={dep.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {dep.version ?? "—"}
                    </td>
                    <td className="px-3 py-2">{dep.environment?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs " +
                          (dep.status === "success"
                            ? "bg-green-500/15 text-green-600"
                            : dep.status === "failed"
                              ? "bg-red-500/15 text-red-600"
                              : "bg-amber-500/15 text-amber-600")
                        }
                      >
                        {dep.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground" dir="ltr">
                      {dep.deployedAt ? new Date(dep.deployedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {dep.status === "success" && dep.version && (
                        <button
                          onClick={() => rollback(dep.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                        >
                          <Server className="h-3 w-3" /> rollback
                        </button>
                      )}
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
