"use client";

import { useState } from "react";
import {
  ArrowLeft,
  FileArchive,
  Files,
  Play,
  Loader2,
  History,
  Cpu,
  Clock,
  Hash,
  Folders,
  HardDrive,
  Code,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useProject,
  useStartRun,
  useFileContent,
  type RunSummary,
} from "./use-forge-api";
import { KindBadge, StatusBadge } from "./status-badge";
import { FileTree } from "./file-tree";
import { renderWorkflowIcon } from "./icon-map";
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
} from "./format";
import { SecretsTab } from "./tabs/secrets-tab";
import { CacheTab } from "./tabs/cache-tab";
import { TriggersTab } from "./tabs/triggers-tab";
import { PipelinesTab } from "./tabs/pipelines-tab";
import { AnalyticsTab } from "./tabs/analytics-tab";
import { CustomWorkflowsTab } from "./tabs/custom-workflows-tab";
import { NotificationsTab } from "./tabs/notifications-tab";
import { SettingsTab } from "./tabs/settings-tab";
import { IntentPanel } from "./intent-panel";

// ---------------------------------------------------------------------------
// Detection rendering
// ---------------------------------------------------------------------------

function DetectionValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="font-mono text-emerald-600 dark:text-emerald-400">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span className="font-mono text-foreground tabular-nums">
        {value.toLocaleString()}
      </span>
    );
  }
  if (typeof value === "string") {
    return (
      <span className="font-mono text-foreground break-all">{value}</span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.length === 0 ? (
          <span className="text-muted-foreground">empty</span>
        ) : (
          value.map((v, i) => (
            <span
              key={i}
              className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]"
            >
              {typeof v === "string" || typeof v === "number"
                ? String(v)
                : JSON.stringify(v)}
            </span>
          ))
        )}
      </div>
    );
  }
  if (typeof value === "object") {
    return <DetectionObject obj={value as Record<string, unknown>} />;
  }
  return <span className="text-muted-foreground">—</span>;
}

function DetectionObject({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">empty</span>;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[minmax(140px,auto)_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:pt-0.5">
            {k}
          </dt>
          <dd className="min-w-0">
            <DetectionValue value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Workflow buttons
// ---------------------------------------------------------------------------

function WorkflowButton({
  icon,
  name,
  description,
  onRun,
  pending,
}: {
  icon: string;
  name: string;
  description: string;
  onRun: () => void;
  pending: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={onRun}
          className="h-auto min-h-[68px] w-full flex-col items-start gap-1 p-4 text-left whitespace-normal"
          aria-label={`Run workflow: ${name}`}
        >
          <span className="flex w-full items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {renderWorkflowIcon(icon, "size-4")}
            </span>
            <span className="truncate text-sm font-semibold">{name}</span>
            {pending ? (
              <Loader2
                className="ml-auto size-3.5 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : (
              <Play
                className="ml-auto size-3.5 text-muted-foreground"
                aria-hidden
              />
            )}
          </span>
          <span className="line-clamp-2 w-full text-xs font-normal text-muted-foreground">
            {description}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Run history row
// ---------------------------------------------------------------------------

function RunRow({
  run,
  onOpen,
}: {
  run: RunSummary;
  onOpen: (runId: string) => void;
}) {
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
      className="cursor-pointer"
    >
      <TableCell className="font-mono text-xs">{run.workflow}</TableCell>
      <TableCell>
        <StatusBadge status={run.status} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatRelativeTime(run.startedAt)}
      </TableCell>
      <TableCell className="text-xs tabular-nums text-muted-foreground">
        {formatDuration(run.durationMs)}
      </TableCell>
      <TableCell className="text-xs tabular-nums">
        {run.exitCode === null || run.exitCode === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : run.exitCode === 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            {run.exitCode}
          </span>
        ) : (
          <span className="text-red-600 dark:text-red-400">{run.exitCode}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// File content side panel
// ---------------------------------------------------------------------------

function FileContentPanel({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const { data, isLoading, isError, error } = useFileContent(projectId, path);

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-4 text-xs text-red-600 dark:text-red-400">
        Failed to load: {error?.message}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <code className="truncate font-mono text-[11px] text-muted-foreground">
          {data.path}
        </code>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {formatBytes(data.size)}
          {data.truncated && " · truncated"}
        </span>
      </div>
      <pre
        className="m-0 flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100"
        style={{ maxHeight: "440px" }}
      >
        <code className="whitespace-pre-wrap break-words">{data.content}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main project detail view
// ---------------------------------------------------------------------------

export function ProjectDetail({
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
  const startRun = useStartRun();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [pendingWorkflow, setPendingWorkflow] = useState<string | null>(null);

  const handleRun = async (workflowKey: string, workflowName: string) => {
    setPendingWorkflow(workflowKey);
    try {
      const res = await startRun.mutateAsync({
        projectId,
        workflow: workflowKey,
      });
      toast.success(`Started “${workflowName}” workflow`);
      onOpenRun(res.runId);
    } catch (e) {
      toast.error(
        `Failed to start run: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setPendingWorkflow(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-3 -ml-2"
          aria-label="Back to project list"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to projects
        </Button>
      </div>

      {isLoading ? (
        <ProjectDetailSkeleton />
      ) : isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load project: {error?.message}
          </CardContent>
        </Card>
      ) : data ? (
        <>
          {/* Header */}
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <FileArchive className="size-6" aria-hidden />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {data.project.name || data.project.fileName}
                </h1>
                <p className="truncate text-sm text-muted-foreground">
                  {data.project.fileName}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <KindBadge kind={data.project.kind} />
                  <span className="text-xs text-muted-foreground">
                    created {formatRelativeTime(data.project.createdAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <Stat
                icon={Files}
                label="Files"
                value={data.project.fileCount.toLocaleString()}
              />
              <Stat
                icon={HardDrive}
                label="Size"
                value={formatBytes(data.project.fileSize)}
              />
              <Stat
                icon={History}
                label="Runs"
                value={data.recentRuns.length.toString()}
              />
              <Stat
                icon={Clock}
                label="Created"
                value={formatDateTime(data.project.createdAt)}
              />
            </div>
          </header>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto p-1">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="secrets">Secrets</TabsTrigger>
              <TabsTrigger value="cache">Cache</TabsTrigger>
              <TabsTrigger value="triggers">Triggers</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6 mt-4">
              {/* Intelligent intent detection — Forge tells you what it thinks you want */}
              <IntentPanel projectId={projectId} onRunStarted={onOpenRun} />

              {/* Detection summary */}
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Cpu className="size-4 text-muted-foreground" aria-hidden />
                    Detection summary
                  </CardTitle>
                  <CardDescription>
                    Auto-detected project metadata. Forge uses this to pick
                    suggested workflows.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.project.detection ? (
                    <DetectionObject obj={data.project.detection} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No detection info available.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Workflows */}
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Play className="size-4 text-muted-foreground" aria-hidden />
                    Workflows
                  </CardTitle>
                  <CardDescription>
                    Pick a workflow to run. Logs stream live in the next view.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.suggestedWorkflows.map((w) => (
                      <WorkflowButton
                        key={w.key}
                        icon={w.icon}
                        name={w.name}
                        description={w.description}
                        pending={
                          pendingWorkflow === w.key || startRun.isPending
                        }
                        onRun={() => void handleRun(w.key, w.name)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* File browser */}
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Folders className="size-4 text-muted-foreground" aria-hidden />
                    Files
                  </CardTitle>
                  <CardDescription>
                    Browse the extracted project. Click a file to preview its
                    contents.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <FileTree
                        projectId={projectId}
                        selectedPath={selectedFile}
                        onSelect={setSelectedFile}
                      />
                    </div>
                    <div className="min-h-[260px] overflow-hidden rounded-lg border bg-card">
                      {selectedFile ? (
                        <FileContentPanel
                          projectId={projectId}
                          path={selectedFile}
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                          <Code className="size-6" aria-hidden />
                          <span>Select a file to preview</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Run history */}
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="size-4 text-muted-foreground" aria-hidden />
                    Recent runs
                  </CardTitle>
                  <CardDescription>
                    Most recent {data.recentRuns.length} run
                    {data.recentRuns.length === 1 ? "" : "s"}. Click a row to view
                    live logs.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.recentRuns.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                      <Terminal className="size-6" aria-hidden />
                      <span>No runs yet. Start a workflow above.</span>
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto rounded-md border [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                      <Table>
                        <TableHeader className="sticky top-0 bg-card">
                          <TableRow>
                            <TableHead className="pl-3">Workflow</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Started</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead className="pr-3">
                              <span className="inline-flex items-center gap-1">
                                <Hash className="size-3" aria-hidden />
                                Exit
                              </span>
                            </TableHead>
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
            </TabsContent>

            <TabsContent value="pipelines" className="mt-4">
              <PipelinesTab projectId={projectId} onOpenPipelineRun={onOpenPipelineRun} />
            </TabsContent>
            <TabsContent value="analytics" className="mt-4">
              <AnalyticsTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="secrets" className="mt-4">
              <SecretsTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="cache" className="mt-4">
              <CacheTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="triggers" className="mt-4">
              <TriggersTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="notifications" className="mt-4">
              <NotificationsTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="custom" className="mt-4">
              <CustomWorkflowsTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="settings" className="mt-4">
              <SettingsTab projectId={projectId} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Files;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <Skeleton className="size-12 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="flex gap-3">
          <Skeleton className="h-16 w-40" />
          <Skeleton className="h-16 w-40" />
          <Skeleton className="h-16 w-40" />
        </CardContent>
      </Card>
    </div>
  );
}
