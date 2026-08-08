"use client";
// ============================================================
// Forge Control Center — one coherent home for every capability.
// Capabilities are grouped by purpose (not a flat wall of tabs),
// and each reuses an existing panel — no duplicates.
// ============================================================
import { useState, useEffect, lazy, Suspense } from "react";
import {
  LayoutDashboard, TerminalSquare, Eye, Rocket, Sparkles, Clock, Settings, Bot,
} from "lucide-react";
import { Loading } from "./ui";

// Existing rich panels.
const GlobalSettings = lazy(() => import("./global-settings").then((m) => ({ default: m.GlobalSettings })));
const ApiTokensPanel = lazy(() => import("./api-tokens-panel").then((m) => ({ default: m.ApiTokensPanel })));
const SystemLogsViewer = lazy(() => import("./system-logs-viewer").then((m) => ({ default: m.SystemLogsViewer })));
const ExperimentsLab = lazy(() => import("./experiments-lab").then((m) => ({ default: m.ExperimentsLab })));
const AIAssistant = lazy(() => import("./ai-assistant").then((m) => ({ default: m.AIAssistant })));
// My capability panels (terminal/observer/sites/mesh/memory/telemetry/metrics/caps).
const TerminalPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.TerminalPanel })));
const ObserverPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.ObserverPanel })));
const SitesPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.SitesPanel })));
const MeshPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.MeshPanel })));
const MemoryPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.MemoryPanel })));
const TelemetryPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.TelemetryPanel })));
const MetricsPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.MetricsPanel })));
const CapabilitiesPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.CapabilitiesPanel })));
// New purpose-built panels.
const StatsPanel = lazy(() => import("./capability-panels").then((m) => ({ default: m.StatsPanel })));
const AuditLogPanel = lazy(() => import("./capability-panels").then((m) => ({ default: m.AuditLogPanel })));
const SchedulerPanel = lazy(() => import("./capability-panels").then((m) => ({ default: m.SchedulerPanel })));
const SearchPanel = lazy(() => import("./capability-panels").then((m) => ({ default: m.SearchPanel })));
const AIAuditPanel = lazy(() => import("./capability-panels").then((m) => ({ default: m.AIAuditPanel })));
const OpenWorkerPanel = lazy(() => import("./openworker-panel").then((m) => ({ default: m.OpenWorkerPanel })));

const CATS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, panels: [["stats", StatsPanel], ["metrics", MetricsPanel], ["caps", CapabilitiesPanel]] },
  { id: "execute", label: "Execute", icon: TerminalSquare, panels: [["terminal", TerminalPanel], ["mesh", MeshPanel], ["memory", MemoryPanel]] },
  { id: "observe", label: "Observe", icon: Eye, panels: [["observer", ObserverPanel], ["telemetry", TelemetryPanel], ["logs", SystemLogsViewer]] },
  { id: "deploy", label: "Deploy", icon: Rocket, panels: [["sites", SitesPanel]] },
  { id: "ai", label: "AI", icon: Sparkles, panels: [["assistant", AIAssistant], ["audit", AIAuditPanel], ["lab", ExperimentsLab]] },
  { id: "agent", label: "Agent", icon: Bot, panels: [["openworker", OpenWorkerPanel]] },
  { id: "automate", label: "Automate", icon: Clock, panels: [["scheduler", SchedulerPanel]] },
  { id: "manage", label: "Manage", icon: Settings, panels: [["settings", GlobalSettings], ["tokens", ApiTokensPanel], ["auditlog", AuditLogPanel], ["search", SearchPanel]] },
] as const;

export function SystemConsole({ category }: { category?: string }) {
  const [cat, setCat] = useState<string>(category || "overview");
  useEffect(() => { if (category) setCat(category); }, [category]);
  const active = CATS.find((c) => c.id === cat) ?? CATS[0];
  return (
    <section className="mx-auto w-full max-w-6xl space-y-5">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <LayoutDashboard className="size-6 text-emerald-600 dark:text-emerald-400" />
          Control Center
        </h2>
        <p className="text-sm text-muted-foreground">
          Every Forge capability in one place, grouped by what it does.
        </p>
      </div>

      {/* Category nav */}
      <div className="flex flex-wrap gap-2">
        {CATS.map((c) => {
          const Icon = c.icon;
          const on = c.id === cat;
          return (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors " +
                (on
                  ? "border-emerald-600 bg-emerald-600/15 text-emerald-600 dark:text-emerald-400"
                  : "border-border text-muted-foreground hover:bg-muted")
              }
            >
              <Icon className="size-4" />
              {c.label}
              <span className="text-[10px] opacity-60">{c.panels.length}</span>
            </button>
          );
        })}
      </div>

      {/* Panels for the active category */}
      <div className="space-y-4">
        {active.panels.map(([key, Comp]) => (
          <Suspense key={key} fallback={<Loading label={`Loading ${active.label}…`} />}>
            <Comp />
          </Suspense>
        ))}
      </div>
    </section>
  );
}
