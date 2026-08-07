"use client";

import { useState, lazy, Suspense } from "react";
import {
  Settings as SettingsIcon,
  Key,
  Terminal as TerminalIcon,
  FlaskConical,
  TerminalSquare,
  Eye,
  Rocket,
  Network,
  Database,
  Activity,
  Gauge,
  Cpu,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loading } from "./ui";

// Lazy-load heavy components.
const GlobalSettings = lazy(() => import("./global-settings").then((m) => ({ default: m.GlobalSettings })));
const ApiTokensPanel = lazy(() => import("./api-tokens-panel").then((m) => ({ default: m.ApiTokensPanel })));
const SystemLogsViewer = lazy(() => import("./system-logs-viewer").then((m) => ({ default: m.SystemLogsViewer })));
const ExperimentsLab = lazy(() => import("./experiments-lab").then((m) => ({ default: m.ExperimentsLab })));

// New capability panels.
const TerminalPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.TerminalPanel })));
const ObserverPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.ObserverPanel })));
const SitesPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.SitesPanel })));
const MeshPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.MeshPanel })));
const MemoryPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.MemoryPanel })));
const TelemetryPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.TelemetryPanel })));
const MetricsPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.MetricsPanel })));
const CapabilitiesPanel = lazy(() => import("./forge-control-panels").then((m) => ({ default: m.CapabilitiesPanel })));

function T(props: { value: string; icon: any; label: string }) {
  return (
    <TabsTrigger value={props.value} className="gap-1.5">
      <props.icon className="size-3.5" />
      <span className="hidden sm:inline">{props.label}</span>
    </TabsTrigger>
  );
}
function C(props: { value: string; label: string; children: React.ReactNode }) {
  return (
    <TabsContent value={props.value} className="mt-4">
      <Suspense fallback={<Loading label={`Loading ${props.label}…`} />}>{props.children}</Suspense>
    </TabsContent>
  );
}

export function SystemConsole() {
  const [tab, setTab] = useState<string>("settings");
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <SettingsIcon className="size-6 text-emerald-600 dark:text-emerald-400" />
          System & Control Center
        </h2>
        <p className="text-sm text-muted-foreground">
          Settings and tokens, plus Forge's live powers: terminal, observer (AI eyes),
          sites (unique links), mesh compute, memory, telemetry, metrics, capabilities.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto py-1">
          <T value="settings" icon={SettingsIcon} label="Settings" />
          <T value="tokens" icon={Key} label="Tokens" />
          <T value="terminal" icon={TerminalSquare} label="Terminal" />
          <T value="observer" icon={Eye} label="Observer" />
          <T value="sites" icon={Rocket} label="Sites" />
          <T value="mesh" icon={Network} label="Mesh" />
          <T value="memory" icon={Database} label="Memory" />
          <T value="telemetry" icon={Activity} label="Telemetry" />
          <T value="metrics" icon={Gauge} label="Metrics" />
          <T value="caps" icon={Cpu} label="Capabilities" />
          <T value="logs" icon={TerminalIcon} label="Logs" />
          <T value="lab" icon={FlaskConical} label="Lab" />
        </TabsList>

        <C value="settings" label="settings"><GlobalSettings /></C>
        <C value="tokens" label="API tokens"><ApiTokensPanel /></C>
        <C value="terminal" label="terminal"><TerminalPanel /></C>
        <C value="observer" label="observer"><ObserverPanel /></C>
        <C value="sites" label="sites"><SitesPanel /></C>
        <C value="mesh" label="mesh"><MeshPanel /></C>
        <C value="memory" label="memory"><MemoryPanel /></C>
        <C value="telemetry" label="telemetry"><TelemetryPanel /></C>
        <C value="metrics" label="metrics"><MetricsPanel /></C>
        <C value="caps" label="capabilities"><CapabilitiesPanel /></C>
        <C value="logs" label="logs"><SystemLogsViewer /></C>
        <C value="lab" label="experiments"><ExperimentsLab /></C>
      </Tabs>
    </section>
  );
}
