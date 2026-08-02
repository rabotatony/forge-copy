"use client";

import { useState, lazy, Suspense } from "react";
import {
  Settings as SettingsIcon,
  Key,
  ScrollText,
  Terminal,
  FlaskConical,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loading } from "./ui";

// Lazy-load heavy components.
const GlobalSettings = lazy(() =>
  import("./global-settings").then((m) => ({ default: m.GlobalSettings })),
);
const ApiTokensPanel = lazy(() =>
  import("./api-tokens-panel").then((m) => ({ default: m.ApiTokensPanel })),
);
const SystemLogsViewer = lazy(() =>
  import("./system-logs-viewer").then((m) => ({ default: m.SystemLogsViewer })),
);
const ExperimentsLab = lazy(() =>
  import("./experiments-lab").then((m) => ({ default: m.ExperimentsLab })),
);

// ---------------------------------------------------------------------------
// SystemConsole — unified operations surface
// ---------------------------------------------------------------------------

export function SystemConsole() {
  const [tab, setTab] = useState<string>("settings");

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <SettingsIcon className="size-6 text-emerald-600 dark:text-emerald-400" />
          System
        </h2>
        <p className="text-sm text-muted-foreground">
          Global settings, API tokens, audit trail, system logs, and the
          Experiments Lab.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="settings" className="gap-1.5">
            <SettingsIcon className="size-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </TabsTrigger>
          <TabsTrigger value="tokens" className="gap-1.5">
            <Key className="size-3.5" />
            <span className="hidden sm:inline">API Tokens</span>
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5">
            <Terminal className="size-3.5" />
            <span className="hidden sm:inline">Logs</span>
          </TabsTrigger>
          <TabsTrigger value="lab" className="gap-1.5">
            <FlaskConical className="size-3.5" />
            <span className="hidden sm:inline">Lab</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          <Suspense fallback={<Loading label="Loading settings…" />}>
            <GlobalSettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="tokens" className="mt-4">
          <Suspense fallback={<Loading label="Loading API tokens…" />}>
            <ApiTokensPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Suspense fallback={<Loading label="Loading logs…" />}>
            <SystemLogsViewer />
          </Suspense>
        </TabsContent>

        <TabsContent value="lab" className="mt-4">
          <Suspense fallback={<Loading label="Loading experiments…" />}>
            <ExperimentsLab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </section>
  );
}
