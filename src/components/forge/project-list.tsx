"use client";

import { useState, useMemo } from "react";
import {
  FileArchive,
  Files,
  History,
  Trash2,
  AlertTriangle,
  Loader2,
  Inbox,
  Search,
  Plus,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useProjects,
  useDeleteProject,
  type ProjectListItem,
} from "./use-forge-api";
import { KindBadge, StatusBadge } from "./status-badge";
import { formatBytes, formatRelativeTime } from "./format";
import { useTranslation } from "./use-translation";
import { EmptyState, ErrorState, Loading } from "./ui";
import { CreateProjectDialog } from "./create-project";
import { useSystemStats } from "./use-forge-api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Project list — the primary landing surface
// ---------------------------------------------------------------------------

export function ProjectList({
  onOpenProject,
  onUploaded,
}: {
  onOpenProject: (id: string) => void;
  onUploaded: (projectId: string) => void;
}) {
  const { data, isLoading, isError, error, refetch } = useProjects();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const { t } = useTranslation();

  const filtered = useMemo(() => {
    if (!data?.projects) return [];
    let result = data.projects;
    if (kindFilter !== "all") result = result.filter((p) => p.kind === kindFilter);
    const q = query.trim().toLowerCase();
    if (q) result = result.filter((p) => p.name.toLowerCase().includes(q) || p.fileName.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q));
    return result;
  }, [data, query, kindFilter]);

  const kindCounts = useMemo(() => {
    if (!data?.projects) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const p of data.projects) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    return counts;
  }, [data]);

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header: title + New Project button */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t("projects.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("projects.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">New Project</span>
        </Button>
      </div>

      {/* System health strip — lightweight, not a full dashboard */}
      <SystemHealthStrip />

      {/* Search + Kind filters */}
      {data && data.projects.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input type="search" placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label="Search projects" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setKindFilter("all")} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${kindFilter === "all" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-card/50 text-muted-foreground hover:bg-accent hover:text-foreground"}`}><span>All</span><span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{data.projects.length}</span></button>
            {Object.entries(kindCounts).sort((a, b) => b[1] - a[1]).map(([kind, count]) => (<button key={kind} type="button" onClick={() => setKindFilter(kind)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${kindFilter === kind ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-card/50 text-muted-foreground hover:bg-accent hover:text-foreground"}`}><span>{kind}</span><span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{count}</span></button>))}
          </div>
        </div>
      )}

      {/* Project grid */}
      {isError ? (
        <ErrorState
          message={`Failed to load projects: ${error?.message ?? "unknown error"}`}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <motion.div
          layout
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={onOpenProject} />
          ))}
        </motion.div>
      ) : (
        <Card className="border-dashed">
          <CardContent>
            <EmptyState
              icon={Inbox}
              title="No projects yet"
              description="Click New Project to upload a ZIP, clone a repo, or start from a template."
              action={
                <Button
                  onClick={() => setCreateOpen(true)}
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Plus className="size-4" />
                  New Project
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onUploaded}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// System health strip — a compact summary, not a full dashboard
// ---------------------------------------------------------------------------

function SystemHealthStrip() {
  const { data, isLoading } = useSystemStats();

  if (isLoading || !data) return null;

  const stats = [
    {
      icon: FileArchive,
      label: "Projects",
      value: data.projects,
      accent: "text-emerald-600 dark:text-emerald-400",
    },
    {
      icon: Activity,
      label: "Total runs",
      value: data.totalRuns,
      accent: "text-sky-600 dark:text-sky-400",
    },
    {
      icon: CheckCircle2,
      label: "Success rate",
      value: data.totalRuns > 0 ? `${Math.round(data.successRate)}%` : "—",
      accent: "text-emerald-600 dark:text-emerald-400",
    },
    {
      icon: XCircle,
      label: "Failed",
      value: data.failedCount,
      accent: "text-rose-600 dark:text-rose-400",
    },
    {
      icon: Clock,
      label: "Avg duration",
      value: data.avgDurationMs > 0 ? `${(data.avgDurationMs / 1000).toFixed(1)}s` : "—",
      accent: "text-amber-600 dark:text-amber-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center gap-2">
          <s.icon className={cn("size-4", s.accent)} aria-hidden />
          <span className="text-sm font-medium tabular-nums">{s.value}</span>
          <span className="text-xs text-muted-foreground">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  onOpen,
}: {
  project: ProjectListItem;
  onOpen: (id: string) => void;
}) {
  const deleteMutation = useDeleteProject();
  const [openDel, setOpenDel] = useState(false);

  const onDelete = async () => {
    try {
      await deleteMutation.mutateAsync(project.id);
      toast.success(`Deleted "${project.name}"`);
    } catch (e) {
      toast.error(
        `Failed to delete project: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setOpenDel(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -2 }}
      className="group relative cursor-pointer"
      onClick={() => onOpen(project.id)}
    >
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardHeader className="gap-2 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileArchive className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold">
                {project.name}
              </h3>
              <p className="truncate text-xs text-muted-foreground">
                {project.fileName}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <KindBadge kind={project.kind} />
            <StatusBadge status={project.lastRunStatus} />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Files className="size-3.5" aria-hidden />
            <span>
              <span className="font-medium text-foreground">
                {project.fileCount}
              </span>{" "}
              files
            </span>
          </div>
          <div className="text-right tabular-nums">
            {formatBytes(project.fileSize)}
          </div>
          <div className="flex items-center gap-1.5">
            <History className="size-3.5" aria-hidden />
            <span>
              <span className="font-medium text-foreground">
                {project.runCount}
              </span>{" "}
              {project.runCount === 1 ? "run" : "runs"}
            </span>
          </div>
          <div className="text-right">{formatRelativeTime(project.createdAt)}</div>
        </CardContent>
      </Card>

      {/* Hover-revealed delete button */}
      <div className="absolute right-3 top-3 opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        <AlertDialog open={openDel} onOpenChange={setOpenDel}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 bg-background/80 backdrop-blur hover:bg-destructive hover:text-white"
              aria-label={`Delete project ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenDel(true);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-red-500" aria-hidden />
                Delete project?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes <strong>{project.name}</strong>, its
                extracted source, all runs, logs, and artifacts. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void onDelete();
                }}
                disabled={deleteMutation.isPending}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  "Delete project"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </motion.div>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-auto h-3 w-12" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-auto h-3 w-16" />
      </CardContent>
    </Card>
  );
}
