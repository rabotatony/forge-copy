"use client";

import { useState, lazy, Suspense } from "react";
import {
  ArrowLeft, FileArchive, Files, History, HardDrive, LayoutGrid, Code2, Workflow, Settings, Download, Loader2, Check, Key, Webhook, Github, Cloud, TerminalSquare,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  useProject,
  type RunSummary,
} from "./use-forge-api";
import { KindBadge, StatusBadge } from "./status-badge";
import { formatBytes, formatRelativeTime } from "./format";
import { ErrorState, Loading, Safe } from "./ui";
import { useStartRun } from "./use-forge-api";
import { toast } from "sonner";

// Lazy-load heavy components.
const IntentPanel = lazy(() => import("./intent-panel").then(m => ({ default: m.IntentPanel })));
const HealthScore = lazy(() => import("./health-score").then(m => ({ default: m.HealthScore })));
const DurationChart = lazy(() => import("./duration-chart").then(m => ({ default: m.DurationChart })));
const AIInsights = lazy(() => import("./ai-insights").then(m => ({ default: m.AIInsights })));
const InsightsPanel = lazy(() => import("./insights-panel").then(m => ({ default: m.InsightsPanel })));
const OnboardingPanel = lazy(() => import("./onboarding-panel").then(m => ({ default: m.OnboardingPanel })));
const CapabilityCard = lazy(() => import("./capability-card").then(m => ({ default: m.CapabilityCard })));
const BuildIntelligencePanel = lazy(() => import("./BuildIntelligencePanel").then(m => ({ default: m.BuildIntelligencePanel })));
const ArtifactsPanel = lazy(() => import("./ArtifactsPanel").then(m => ({ default: m.ArtifactsPanel })));
const DeploymentsPanel = lazy(() => import("./DeploymentsPanel").then(m => ({ default: m.DeploymentsPanel })));
const ActivityTimeline = lazy(() => import("./activity-timeline").then(m => ({ default: m.ActivityTimeline })));
const RunComparison = lazy(() => import("./run-comparison").then(m => ({ default: m.RunComparison })));
const RunDiffViewer = lazy(() => import("./run-diff-viewer").then(m => ({ default: m.RunDiffViewer })));
const FileExplorer = lazy(() => import("./file-explorer").then(m => ({ default: m.FileExplorer })));
const RepositoryPanel = lazy(() => import("./repository-panel").then(m => ({ default: m.RepositoryPanel })));
const CodeMetrics = lazy(() => import("./code-metrics").then(m => ({ default: m.CodeMetrics })));
const DependencyScanner = lazy(() => import("./dependency-scanner").then(m => ({ default: m.DependencyScanner })));
const WorkflowCatalog = lazy(() => import("./workflow-catalog").then(m => ({ default: m.WorkflowCatalog })));
const PresetsGallery = lazy(() => import("./presets-gallery").then(m => ({ default: m.PresetsGallery })));
const VisualPipelineBuilder = lazy(() => import("./visual-pipeline-builder").then(m => ({ default: m.VisualPipelineBuilder })));
const PipelinesTab = lazy(() => import("./tabs/pipelines-tab").then(m => ({ default: m.PipelinesTab })));
const CustomWorkflowsTab = lazy(() => import("./tabs/custom-workflows-tab").then(m => ({ default: m.CustomWorkflowsTab })));
const SecretsTab = lazy(() => import("./tabs/secrets-tab").then(m => ({ default: m.SecretsTab })));
const EnvVarsEditor = lazy(() => import("./env-vars-editor").then(m => ({ default: m.EnvVarsEditor })));
const GitHubTab = lazy(() => import("./tabs/github-tab").then(m => ({ default: m.GitHubTab })));
const CloudBuildTab = lazy(() => import("./tabs/cloud-build-tab").then(m => ({ default: m.CloudBuildTab })));
const TerminalTab = lazy(() => import("./tabs/terminal-tab").then(m => ({ default: m.TerminalTab })));
const CacheTab = lazy(() => import("./tabs/cache-tab").then(m => ({ default: m.CacheTab })));
const TriggersTab = lazy(() => import("./tabs/triggers-tab").then(m => ({ default: m.TriggersTab })));
const NotificationsTab = lazy(() => import("./tabs/notifications-tab").then(m => ({ default: m.NotificationsTab })));
const EnvironmentsPanel = lazy(() => import("./environments-panel").then(m => ({ default: m.EnvironmentsPanel })));
const ApiTokensPanel = lazy(() => import("./api-tokens-panel").then(m => ({ default: m.ApiTokensPanel })));
const SettingsTab = lazy(() => import("./tabs/settings-tab").then(m => ({ default: m.SettingsTab })));
const CloneProjectButton = lazy(() => import("./clone-project-button").then(m => ({ default: m.CloneProjectButton })));

// ---------------------------------------------------------------------------
// Project workspace — 4 tabs: Overview | Code | Pipelines | Configure
// ---------------------------------------------------------------------------

export function ProjectWorkspace({
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
  const [tab, setTab] = useState<string>("overview");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const startRun = useStartRun();

  // Auto-dismiss onboarding if the project already has runs
  const hasRuns = (data as { recentRuns?: unknown[] } | undefined)?.recentRuns &&
    (data as { recentRuns: unknown[] }).recentRuns.length > 0;
  const showOnboarding = !onboardingDismissed && !hasRuns;

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-6xl space-y-4">
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
      <section className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        </div>
        <ErrorState message={`Failed to load project: ${error?.message ?? "unknown error"}`} onRetry={onBack} />
      </section>
    );
  }

  const project = data.project;
  const recentRuns = (data as { recentRuns?: RunSummary[] }).recentRuns ?? [];
  const hasRepo = !!project.repoUrl;

  return (
    <section className="mx-auto w-full max-w-6xl space-y-4">
      {/* Project header */}
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
                {project.name || project.fileName}
              </h1>
              <div className="flex items-center gap-1.5">
                <KindBadge kind={project.kind} />
                <span className="text-xs text-muted-foreground">
                  · {formatRelativeTime(project.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick stats + clone */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Stat icon={Files} value={project.fileCount.toLocaleString()} label="files" />
          <Stat icon={HardDrive} value={formatBytes(project.fileSize)} label="size" />
          <Stat icon={History} value={recentRuns.length.toString()} label="runs" />
          <Suspense fallback={null}>
            <CloneProjectButton projectId={projectId} onCloned={() => onBack()} />
          </Suspense>
          <a
            href={`/api/forge/projects/${projectId}/export`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Download className="size-3.5" />
            <span className="hidden sm:inline">Export ZIP</span>
          </a>
        </div>
      </div>

      {/* 4-tab workspace */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
          <TabsTrigger value="overview" className="gap-1.5">
            <LayoutGrid className="size-3.5" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="code" className="gap-1.5">
            <Code2 className="size-3.5" />
            <span className="hidden sm:inline">Code</span>
          </TabsTrigger>
          <TabsTrigger value="pipelines" className="gap-1.5">
            <Workflow className="size-3.5" />
            <span className="hidden sm:inline">Pipelines</span>
          </TabsTrigger>
          <TabsTrigger value="github" className="gap-1.5"><Github className="size-3.5"/><span className="hidden sm:inline">GitHub</span></TabsTrigger>
          <TabsTrigger value="cloud" className="gap-1.5"><Cloud className="size-3.5"/><span className="hidden sm:inline">Cloud Build</span></TabsTrigger>
          <TabsTrigger value="terminal" className="gap-1.5"><TerminalSquare className="size-3.5"/><span className="hidden sm:inline">Terminal</span></TabsTrigger>
          <TabsTrigger value="configure" className="gap-1.5">
            <Settings className="size-3.5" />
            <span className="hidden sm:inline">Configure</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Overview tab — run-centric dashboard ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Suspense fallback={<Loading label="Loading overview…" />}>
            {/* Onboarding — shows on first open, auto-dismisses after first run */}
            {showOnboarding && (
              <OnboardingPanel
                projectId={projectId}
                onRunWorkflow={async (wf) => {
                  try {
                    const result = await startRun.mutateAsync({ projectId, workflow: wf });
                    toast.success(`Started ${wf} workflow`);
                    onOpenRun(result.runId);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : `Failed to start ${wf}`);
                  }
                }}
                onDismiss={() => { setOnboardingDismissed(true); try { localStorage.setItem(`forge-onboarding-dismissed-${projectId}`, "1"); } catch {} }}
              />
            )}

            {/* Capability Card — what Forge detected + what it can do */}
            <Safe label="Capability overview"><CapabilityCard projectId={projectId} /></Safe>

            {/* Build Intelligence — capabilities + one-click config generation */}
            <Safe label="Build intelligence"><BuildIntelligencePanel projectId={projectId} /></Safe>
            <Safe label="Artifacts"><ArtifactsPanel projectId={projectId} /></Safe>

            {/* Insights — profile-aware recommendations */}
            <Safe label="Insights"><InsightsPanel projectId={projectId} onRunStarted={onOpenRun} /></Safe>

            {/* Activity Timeline — unified feed */}
            <Safe label="Activity timeline"><ActivityTimeline projectId={projectId} onOpenRun={onOpenRun} /></Safe>

            {/* Collapsible advanced analysis */}
            <details className="group rounded-lg border border-border bg-card/30">
              <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
                <span>Advanced analysis (intent, health, trends, AI, run comparison)</span>
                <span className="text-xs transition-transform group-open:rotate-90">▶</span>
              </summary>
              <div className="space-y-4 border-t border-border p-4">
                {/* Intent + quick-run */}
                <IntentPanel projectId={projectId} onRunStarted={onOpenRun} />

                {/* Health + trends side by side */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <HealthScore projectId={projectId} />
                  <DurationChart projectId={projectId} />
                </div>

                {/* AI insights */}
                <AIInsights projectId={projectId} />

                {/* Run comparison + diff viewer */}
                <RunComparison projectId={projectId} />
                <RunDiffViewer projectId={projectId} />
              </div>
            </details>

            {/* Recent runs table */}
            <RecentRunsCard runs={recentRuns} onOpenRun={onOpenRun} />
          </Suspense>
        </TabsContent>

        {/* ── Code tab — files + git ── */}
        <TabsContent value="code" className="mt-4 space-y-4">
          <Suspense fallback={<Loading label="Loading code…" />}>
            <CodeWorkspace projectId={projectId} />
            {hasRepo && <RepositoryPanel projectId={projectId} />}
            <CodeMetrics projectId={projectId} />
            <DependencyScanner projectId={projectId} />
          </Suspense>
        </TabsContent>

        {/* ── Pipelines tab — what to run ── */}
        <TabsContent value="pipelines" className="mt-4 space-y-4">
          <Suspense fallback={<Loading label="Loading pipelines…" />}>
            {/* Predefined workflows */}
            <WorkflowCatalog projectId={projectId} onRunStarted={onOpenRun} />

            {/* Curated preset sequences */}
            <PresetsGallery projectId={projectId} onPipelineStarted={onOpenPipelineRun} />

            {/* Multi-stage pipeline builder + saved pipelines */}
            <VisualPipelineBuilder projectId={projectId} onPipelineStarted={onOpenPipelineRun} />
            <PipelinesTab projectId={projectId} onOpenPipelineRun={onOpenPipelineRun} />

            {/* Custom workflow editor */}
            <CustomWorkflowsTab projectId={projectId} />
          </Suspense>
        </TabsContent>

        {/* ── Configure tab — how to configure (sub-grouped) ── */}
        <TabsContent value="github" className="mt-4"><Suspense fallback={<Loading label="Loading GitHub…"/>}><GitHubTab projectId={projectId} /></Suspense></TabsContent>
        <TabsContent value="cloud" className="mt-4"><Suspense fallback={<Loading label="Loading cloud build…"/>}><CloudBuildTab projectId={projectId} /></Suspense></TabsContent>
          <TabsContent value="terminal" className="mt-4"><Suspense fallback={<Loading label="Loading terminal…"/>}><TerminalTab /></Suspense></TabsContent>
        <TabsContent value="configure" className="mt-4">
          <Suspense fallback={<Loading label="Loading configuration…" />}>
            <ConfigureTabs projectId={projectId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Stat({ icon: Icon, value, label }: { icon: typeof Files; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="font-medium text-foreground tabular-nums">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function RecentRunsCard({
  runs,
  onOpenRun,
}: {
  runs: RunSummary[];
  onOpenRun: (runId: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No runs yet. Use the intent panel above or the Pipelines tab to run a workflow.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">Recent runs</h3>
        </div>
        <div className="divide-y divide-border">
          {runs.slice(0, 10).map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onOpenRun(run.id)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
            >
              <StatusBadge status={run.status} />
              <span className="flex-1 truncate font-mono text-xs text-foreground">
                {run.workflow}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {formatRelativeTime(run.startedAt)}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CodeWorkspace — file explorer + viewer + editor + create
// ---------------------------------------------------------------------------

function CodeWorkspace({ projectId }: { projectId: string }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const handleSelect = async (path: string) => {
    setSelectedFile(path);
    setEditing(false);
    setLoading(true);
    try {
      const r = await fetch(`/api/forge/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`);
      if (r.ok) {
        const data = await r.json();
        const c = data.content ?? "(binary or empty file)";
        setContent(c);
        setEditContent(c);
        setTruncated(data.truncated === true);
      } else {
        setContent("(unable to load file content)");
        setEditContent("");
        setTruncated(false);
      }
    } catch {
      setContent("(error loading file)");
      setEditContent("");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/forge/projects/${projectId}/files/update`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: { [selectedFile]: editContent } }),
      });
      if (r.ok) {
        toast.success(`Saved ${selectedFile}`);
        setContent(editContent);
        setEditing(false);
      } else {
        toast.error("Failed to save file");
      }
    } catch {
      toast.error("Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/forge/projects/${projectId}/files/update`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: { [newFileName]: "" } }),
      });
      if (r.ok) {
        toast.success(`Created ${newFileName}`);
        setCreatingFile(false);
        setNewFileName("");
        setSelectedFile(newFileName);
        setContent("");
        setEditContent("");
        setEditing(true);
      } else {
        toast.error("Failed to create file");
      }
    } catch {
      toast.error("Failed to create file");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Files</h3>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={() => setCreatingFile(!creatingFile)}
        >
          <Code2 className="size-3.5" />
          New File
        </Button>
      </div>

      {/* New file input */}
      {creatingFile && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-2">
          <input
            type="text"
            placeholder="path/to/new-file.ts"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateFile()}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs font-mono"
            autoFocus
          />
          <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={saving || !newFileName.trim()} onClick={handleCreateFile}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Create
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setCreatingFile(false); setNewFileName(""); }}>
            Cancel
          </Button>
        </div>
      )}

      {/* Split panel: file tree + content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <div>
          <FileExplorer projectId={projectId} onSelect={handleSelect} />
        </div>

        <Card className="min-h-[400px]">
          <CardContent className="p-0">
            {selectedFile ? (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <code className="text-xs font-medium text-foreground">{selectedFile}</code>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      {loading ? "Loading…" : `${(content ?? "").length} chars${truncated ? " (truncated)" : ""}`}
                    </span>
                    {!loading && content && !content.startsWith("(") && (
                      <>
                        {editing ? (
                          <>
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={saving} onClick={() => { setEditing(false); setEditContent(content ?? ""); }}>
                              Cancel
                            </Button>
                            <Button size="sm" className="h-7 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={saving} onClick={handleSave}>
                              {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                              Save
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)}>
                            <Code2 className="size-3" />
                            Edit
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {editing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="h-[600px] w-full resize-none bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="max-h-[600px] overflow-auto p-4 text-xs leading-relaxed">
                    <code className="font-mono text-muted-foreground">
                      {loading ? "Loading…" : content}
                    </code>
                  </pre>
                )}
              </>
            ) : (
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 text-center">
                <Code2 className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Select a file to view or edit its content
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfigureTabs — groups 8 config panels into 3 sub-tabs
// ---------------------------------------------------------------------------

function ConfigureTabs({ projectId }: { projectId: string }) {
  const [subTab, setSubTab] = useState<"build" | "automate" | "access">("build");
  const subTabs = [
    { id: "build" as const, label: "Build & Secrets", icon: Key },
    { id: "automate" as const, label: "Automate", icon: Webhook },
    { id: "access" as const, label: "Access & Settings", icon: Settings },
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card/30 p-1 [&::-webkit-scrollbar]:w-1.5">
        {subTabs.map((st) => (
          <button key={st.id} type="button" onClick={() => setSubTab(st.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${subTab === st.id ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
            <st.icon className="size-3.5" />{st.label}
          </button>
        ))}
      </div>
      {subTab === "build" && (<div className="space-y-4"><SecretsTab projectId={projectId} /><EnvVarsEditor projectId={projectId} /><CacheTab projectId={projectId} /></div>)}
      {subTab === "automate" && (<div className="space-y-4"><TriggersTab projectId={projectId} /><NotificationsTab projectId={projectId} /><EnvironmentsPanel projectId={projectId} /><DeploymentsPanel projectId={projectId} /></div>)}
      {subTab === "access" && (<div className="space-y-4"><ApiTokensPanel /><SettingsTab projectId={projectId} /></div>)}
    </div>
  );
}
