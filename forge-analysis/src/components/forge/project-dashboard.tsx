"use client";

import { useState, lazy, Suspense } from "react";
import {
  ArrowLeft,
  FileArchive,
  Files,
  History,
  HardDrive,
  Clock,
  LayoutGrid,
  GitBranch,
  BarChart3,
  Key,
  Database,
  Webhook,
  Bell,
  Code2,
  Settings,
  Terminal,
  Cpu,
  Folders,
  Zap,
  Rocket,
  Server,
  GitFork as GitForkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useProject,
  useStartRun,
  type RunSummary,
} from "./use-forge-api";
import { KindBadge, StatusBadge } from "./status-badge";
import { renderWorkflowIcon } from "./icon-map";
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "./format";
import { IntentPanel } from "./intent-panel";
import { AIAssistant } from "./ai-assistant";
import { useTranslation } from "./use-translation";

// Lazy-load heavy components to reduce initial bundle + memory.
const WorkflowCatalog = lazy(() => import("./workflow-catalog").then(m => ({ default: m.WorkflowCatalog })));
const PresetsGallery = lazy(() => import("./presets-gallery").then(m => ({ default: m.PresetsGallery })));
const EnvironmentsPanel = lazy(() => import("./environments-panel").then(m => ({ default: m.EnvironmentsPanel })));
const ApiTokensPanel = lazy(() => import("./api-tokens-panel").then(m => ({ default: m.ApiTokensPanel })));
const ScheduledRunsPanel = lazy(() => import("./scheduled-runs-panel").then(m => ({ default: m.ScheduledRunsPanel })));
const VisualPipelineBuilder = lazy(() => import("./visual-pipeline-builder").then(m => ({ default: m.VisualPipelineBuilder })));
const RunComparison = lazy(() => import("./run-comparison").then(m => ({ default: m.RunComparison })));
const MatrixVisualization = lazy(() => import("./matrix-visualization").then(m => ({ default: m.MatrixVisualization })));
const EnvVarsEditor = lazy(() => import("./env-vars-editor").then(m => ({ default: m.EnvVarsEditor })));
const CodeMetrics = lazy(() => import("./code-metrics").then(m => ({ default: m.CodeMetrics })));
const DependencyScanner = lazy(() => import("./dependency-scanner").then(m => ({ default: m.DependencyScanner })));
const RunQueuePanel = lazy(() => import("./run-queue-panel").then(m => ({ default: m.RunQueuePanel })));
const WorkflowShare = lazy(() => import("./workflow-share").then(m => ({ default: m.WorkflowShare })));
const ActivityHeatmap = lazy(() => import("./activity-heatmap").then(m => ({ default: m.ActivityHeatmap })));
const DurationChart = lazy(() => import("./duration-chart").then(m => ({ default: m.DurationChart })));
const HealthScore = lazy(() => import("./health-score").then(m => ({ default: m.HealthScore })));
const MarketplaceBrowser = lazy(() => import("./marketplace-browser").then(m => ({ default: m.MarketplaceBrowser })));
const FileExplorer = lazy(() => import("./file-explorer").then(m => ({ default: m.FileExplorer })));
const AIInsights = lazy(() => import("./ai-insights").then(m => ({ default: m.AIInsights })));
const RunDiffViewer = lazy(() => import("./run-diff-viewer").then(m => ({ default: m.RunDiffViewer })));
const CloneProjectButton = lazy(() => import("./clone-project-button").then(m => ({ default: m.CloneProjectButton })));
const SecretsTab = lazy(() => import("./tabs/secrets-tab").then(m => ({ default: m.SecretsTab })));
const CacheTab = lazy(() => import("./tabs/cache-tab").then(m => ({ default: m.CacheTab })));
const TriggersTab = lazy(() => import("./tabs/triggers-tab").then(m => ({ default: m.TriggersTab })));
const PipelinesTab = lazy(() => import("./tabs/pipelines-tab").then(m => ({ default: m.PipelinesTab })));
const AnalyticsTab = lazy(() => import("./tabs/analytics-tab").then(m => ({ default: m.AnalyticsTab })));
const CustomWorkflowsTab = lazy(() => import("./tabs/custom-workflows-tab").then(m => ({ default: m.CustomWorkflowsTab })));
const RepositoryPanel = lazy(() => import("./repository-panel").then(m => ({ default: m.RepositoryPanel })));
const NotificationsTab = lazy(() => import("./tabs/notifications-tab").then(m => ({ default: m.NotificationsTab })));
const SettingsTab = lazy(() => import("./tabs/settings-tab").then(m => ({ default: m.SettingsTab })));

// ---------------------------------------------------------------------------
// Sidebar navigation items
// ---------------------------------------------------------------------------

type SectionId =
  | "overview"
  | "presets"
  | "workflows"
  | "pipelines"
  | "repository"
  | "activity"
  | "analytics"
  | "automate"
  | "configure"
  | "custom";

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof LayoutGrid;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid, description: "Intent, stats, files, recent runs" },
  { id: "presets", label: "Presets", icon: Rocket, description: "One-click workflow sequences" },
  { id: "workflows", label: "Workflows", icon: Zap, description: "All 33 workflows, searchable" },
  { id: "pipelines", label: "Pipelines", icon: GitBranch, description: "Multi-stage DAG builder" },
  { id: "repository", label: "Repository", icon: GitForkIcon, description: "Hold & maintain a git repo" },
  { id: "activity", label: "Activity", icon: History, description: "Run history & live runs" },
  { id: "analytics", label: "Analytics", icon: BarChart3, description: "Trends, failures, comparisons" },
  { id: "automate", label: "Automate", icon: Webhook, description: "Triggers, notifications, environments" },
  { id: "configure", label: "Configure", icon: Settings, description: "Secrets, env, cache, settings" },
  { id: "custom", label: "Custom", icon: Code2, description: "Custom workflow editor" },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectDashboard({
  projectId,
  onBack,
  onOpenRun,
  onOpenPipelineRun,
}: {
  projectId: string;
  onBack: () => void;
  onOpenRun: (runId: string) => void;
  onOpenPipelineRun: (pipelineRunId: string) => void;
}) {
  const { data, isLoading, isError, error } = useProject(projectId);
  const [section, setSection] = useState<SectionId>("overview");

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-7xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="mx-auto w-full max-w-7xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load project: {error?.message}
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl space-y-4">
      {/* Top bar: back + project header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Projects</span>
          </Button>
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileArchive className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {data.project.name || data.project.fileName}
              </h1>
              <div className="flex items-center gap-1.5">
                <KindBadge kind={data.project.kind} />
                <span className="text-xs text-muted-foreground">
                  · {formatRelativeTime(data.project.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick stats + clone button */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Stat icon={Files} value={(data.project.fileCount ?? 0).toLocaleString()} label="files" />
          <Stat icon={HardDrive} value={formatBytes(data.project.fileSize ?? 0)} label="size" />
          <Stat icon={History} value={(data.recentRuns ?? []).length.toString()} label="runs" />
          <Suspense fallback={null}>
            <CloneProjectButton projectId={projectId} onCloned={(newId) => { onBack(); }} />
          </Suspense>
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Sidebar */}
        <nav
          aria-label="Project sections"
          className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-visible"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors lg:w-full",
                  active
                    ? "bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active && "text-emerald-600 dark:text-emerald-400",
                  )}
                  aria-hidden
                />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Content area */}
        <div className="min-w-0 flex-1">
          <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}>
          {section === "overview" && (
            <OverviewSection
              projectId={projectId}
              data={data}
              onOpenRun={onOpenRun}
              onOpenPipelineRun={onOpenPipelineRun}
            />
          )}
          {section === "presets" && (
            <Card>
              <CardHeader className="gap-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Rocket className="size-4 text-emerald-600" aria-hidden />
                  Workflow Presets
                </CardTitle>
                <CardDescription>
                  Curated one-click sequences tuned for common goals. Each
                  preset chains multiple workflows into a single action.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PresetsGallery
                  projectId={projectId}
                  onPipelineStarted={onOpenPipelineRun}
                />
              </CardContent>
            </Card>
          )}
          {section === "workflows" && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="size-4 text-emerald-600" aria-hidden />
                    Workflow Catalog
                  </CardTitle>
                  <CardDescription>
                    All workflows available for this project. Search, filter by
                    category, and run with one click.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <WorkflowCatalog projectId={projectId} onRunStarted={onOpenRun} />
                </CardContent>
              </Card>
              <MarketplaceBrowser projectId={projectId} />
            </div>
          )}
          {section === "pipelines" && (
            <div className="space-y-4">
              <VisualPipelineBuilder
                projectId={projectId}
                onPipelineStarted={onOpenPipelineRun}
              />
              <PipelinesTab
                projectId={projectId}
                onOpenPipelineRun={onOpenPipelineRun}
              />
            </div>
          )}
          {section === "repository" && (
            <RepositoryPanel projectId={projectId} />
          )}
          {section === "activity" && (
            <ActivitySection
              runs={data.recentRuns}
              onOpenRun={onOpenRun}
            />
          )}
          {section === "analytics" && (
            <div className="space-y-4">
              <AIInsights projectId={projectId} />
              <HealthScore projectId={projectId} />
              <RunQueuePanel projectId={projectId} />
              <DurationChart projectId={projectId} />
              <ActivityHeatmap projectId={projectId} />
              <MatrixVisualization projectId={projectId} />
              <RunComparison projectId={projectId} />
              <RunDiffViewer projectId={projectId} />
              <DependencyScanner projectId={projectId} />
              <AnalyticsTab projectId={projectId} />
            </div>
          )}
          {section === "automate" && (
            <div className="space-y-4">
              <ScheduledRunsPanel projectId={projectId} />
              <EnvironmentsPanel projectId={projectId} />
              <TriggersTab projectId={projectId} />
              <NotificationsTab projectId={projectId} />
            </div>
          )}
          {section === "configure" && (
            <div className="space-y-4">
              <ApiTokensPanel />
              <SecretsTab projectId={projectId} />
              <EnvVarsEditor projectId={projectId} />
              <CacheTab projectId={projectId} />
              <SettingsTab projectId={projectId} />
            </div>
          )}
          {section === "custom" && (
            <div className="space-y-4">
              <WorkflowShare projectId={projectId} />
              <CustomWorkflowsTab projectId={projectId} />
            </div>
          )}
          </Suspense>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Overview section — intent hero + detection + files + recent runs
// ---------------------------------------------------------------------------

function OverviewSection({
  projectId,
  data,
  onOpenRun,
  onOpenPipelineRun,
}: {
  projectId: string;
  data: { project: { detection: Record<string, unknown> | null }; recentRuns: RunSummary[] };
  onOpenRun: (runId: string) => void;
  onOpenPipelineRun: (pipelineRunId: string) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* AI Assistant — talk to Forge in natural language */}
      <AIAssistant
        projectId={projectId}
        onOpenRun={onOpenRun}
        onOpenPipelineRun={onOpenPipelineRun}
      />

      {/* Intent hero — the star of the show */}
      <IntentPanel projectId={projectId} onRunStarted={onOpenRun} />

      {/* Code metrics — deep analysis */}
      <CodeMetrics projectId={projectId} />

      {/* Detection + Files side by side */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="size-4 text-muted-foreground" aria-hidden />
              Detection
            </CardTitle>
            <CardDescription>
              Auto-detected project metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.project.detection ? (
              <DetectionCompact obj={data.project.detection} />
            ) : (
              <p className="text-sm text-muted-foreground">No detection info.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Folders className="size-4 text-muted-foreground" aria-hidden />
              Files
            </CardTitle>
            <CardDescription>
              Browse the extracted project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<div className="py-4 text-sm text-muted-foreground">Loading files…</div>}>
              <FileExplorer
                projectId={projectId}
                onSelect={setSelectedFile}
              />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      {/* Recent runs */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" aria-hidden />
            Recent runs
          </CardTitle>
          <CardDescription>
            {data.recentRuns.length} run{data.recentRuns.length === 1 ? "" : "s"}. Click a row for live logs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentRuns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <Terminal className="size-6 opacity-40" aria-hidden />
              <span>No runs yet. Use Auto-run above or pick a workflow.</span>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-md border [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="pl-3">Workflow</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="pr-3">Exit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentRuns.map((r) => (
                    <RunRow key={r.id} run={r} onOpen={onOpenRun} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity section — full-width run history
// ---------------------------------------------------------------------------

function ActivitySection({
  runs,
  onOpenRun,
}: {
  runs: RunSummary[];
  onOpenRun: (runId: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-muted-foreground" aria-hidden />
          All runs
        </CardTitle>
        <CardDescription>
          Complete run history for this project. Click any row for live logs, artifacts, and test reports.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Terminal className="size-6 opacity-40" aria-hidden />
            <span>No runs yet.</span>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto rounded-md border [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="pl-3">Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="pr-3">Exit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} onOpen={onOpenRun} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Stat({ icon: Icon, value, label }: { icon: typeof Files; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="font-medium text-foreground">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function DetectionCompact({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).slice(0, 8);
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {k}
          </dt>
          <dd className="truncate font-mono text-foreground">
            {v === null || v === undefined ? "—" : typeof v === "object" ? `${Object.keys(v).length} keys` : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RunRow({ run, onOpen }: { run: RunSummary; onOpen: (id: string) => void }) {
  return (
    <TableRow
      role="button"
      tabIndex={0}
      onClick={() => onOpen(run.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(run.id);
        }
      }}
      className="cursor-pointer hover:bg-accent/50"
    >
      <TableCell className="pl-3 font-mono text-xs">
        {run.workflow}
      </TableCell>
      <TableCell>
        <StatusBadge status={run.status} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatRelativeTime(run.startedAt)}
      </TableCell>
      <TableCell className="text-xs tabular-nums">
        {run.durationMs ? formatDuration(run.durationMs) : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {run.trigger ?? "manual"}
      </TableCell>
      <TableCell className="pr-3 font-mono text-xs tabular-nums">
        {run.exitCode ?? "—"}
      </TableCell>
    </TableRow>
  );
}
