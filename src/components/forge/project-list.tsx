"use client";

import { useState, useMemo, useEffect } from "react";
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
  Anvil,
  Flame,
  Upload,
  GitBranch,
  LayoutTemplate,
  ArrowRight,
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setCreateOpen(true);
    window.addEventListener("forge:open-upload", onOpen);
    return () => window.removeEventListener("forge:open-upload", onOpen);
  }, []);
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
        <ForgeEmpty onNew={() => setCreateOpen(true)} />
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
// ForgeEmpty — the first-run onboarding, told in the forge language
// ---------------------------------------------------------------------------
const EMPTY_SPARKS = [
  { l: 18, d: 0.0, dur: 3.4, dr: 10, s: 3 },
  { l: 42, d: 1.2, dur: 4.2, dr: -8, s: 2 },
  { l: 66, d: 0.6, dur: 3.8, dr: 12, s: 3 },
  { l: 84, d: 2.0, dur: 4.6, dr: -10, s: 2 },
];
const EMPTY_OPTS = [
  { icon: Upload, title: "Upload a project", line: "Drop a ZIP or any archive — Forge unpacks it and reads what it is." },
  { icon: GitBranch, title: "Clone a repository", line: "Point Forge at a Git repo and pull the source straight in." },
  { icon: LayoutTemplate, title: "Start from a template", line: "Begin with a ready-made scaffold from the library." },
] as const;

function ForgeEmpty({ onNew }: { onNew: () => void }) {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-amber-400/15 bg-[#0c0a08] px-6 py-14 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 bottom-0 h-[80%] forge-flame"
             style={{ background: "radial-gradient(55% 80% at 50% 115%, rgba(207,84,44,0.35), rgba(230,127,56,0.15) 45%, transparent 70%)" }} />
        <div className="absolute bottom-[-40px] left-1/2 h-[220px] w-[440px] -translate-x-1/2 forge-heat-drift"
             style={{ background: "radial-gradient(closest-side, rgba(255,164,105,0.25), transparent)", filter: "blur(26px)" }} />
        {EMPTY_SPARKS.map((k, i) => (
          <span key={i} className="forge-spark absolute bottom-[6%] rounded-full"
            style={{ left: `${k.l}%`, width: k.s, height: k.s, background: "rgb(255,200,130)", boxShadow: "0 0 8px 2px rgba(255,164,105,0.8)",
              ["--spark-dur" as any]: `${k.dur}s`, ["--spark-delay" as any]: `${k.d}s`, ["--spark-drift" as any]: `${k.dr}px` }} />
        ))}
      </div>

      <div className="forge-reveal relative mx-auto mb-6 w-fit">
        <span className="forge-ember absolute inset-0 rounded-2xl" style={{ boxShadow: "0 0 52px 12px rgba(230,127,56,0.3)" }} />
        <span className="relative flex size-16 items-center justify-center rounded-2xl border border-amber-400/30 bg-gradient-to-b from-[#2a1a10] to-[#171008]">
          <Anvil className="size-8 text-amber-400" aria-hidden />
        </span>
      </div>

      <h3 className="forge-reveal forge-d1 text-2xl font-semibold tracking-tight text-[#f5ead6]">Light your first forge</h3>
      <p className="forge-reveal forge-d2 mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#b6ae9f]">
        Every build starts as raw material. Bring a project in and Forge will shape it — analyze, build, deploy, and verify.
      </p>

      <div className="forge-reveal forge-d3 mx-auto mt-9 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
        {EMPTY_OPTS.map((o) => {
          const Icon = o.icon;
          return (
            <button key={o.title} type="button" onClick={onNew}
              className="forge-card rounded-xl border border-amber-400/10 bg-[#141009]/70 p-4 text-left backdrop-blur-sm">
              <span className="mb-2.5 flex size-9 items-center justify-center rounded-lg bg-amber-400/10 text-amber-400">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="text-sm font-semibold text-[#ece3d0]">{o.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-[#9b948a]">{o.line}</p>
            </button>
          );
        })}
      </div>

      <button type="button" onClick={onNew}
        className="forge-flame forge-reveal forge-d4 group mt-9 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-3 text-sm font-semibold text-[#1a0d04] shadow-[0_8px_28px_-6px_rgba(230,127,56,0.5)] transition-transform hover:scale-[1.03]">
        <Flame className="size-4" aria-hidden />
        Start a new project
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </button>
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
