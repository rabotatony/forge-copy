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
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
import { ForgeDropzone } from "./dropzone";
import { GitImport } from "./git-import";
import { ScriptGenerator } from "./script-generator";
import { KindBadge, StatusBadge } from "./status-badge";
import { formatBytes, formatRelativeTime } from "./format";
import { AIAssistant } from "./ai-assistant";
import { useTranslation } from "./use-translation";
import dynamic from "next/dynamic";

// Lazy-load the stats dashboard to reduce initial bundle + memory.
const SystemStatsDashboard = dynamic(
  () => import("./system-stats").then((m) => m.SystemStatsDashboard),
  { ssr: false, loading: () => null },
);

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
      toast.success(`Deleted “${project.name}”`);
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className="group relative"
    >
      <Card
        role="button"
        tabIndex={0}
        aria-label={`Open project ${project.name}`}
        onClick={() => onOpen(project.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(project.id);
          }
        }}
        className={cn(
          "h-full cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <CardHeader className="gap-2 pb-3">
          <div className="flex items-start gap-2 pr-8">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileArchive className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">
                {project.name || project.fileName}
              </CardTitle>
              <CardDescription className="truncate text-xs">
                {project.fileName}
              </CardDescription>
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
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
          <AlertDialogContent
            onClick={(e) => e.stopPropagation()}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle
                  className="size-5 text-red-500"
                  aria-hidden
                />
                Delete project?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes <strong>{project.name}</strong>, its
                extracted source, all runs, logs, and artifacts. This cannot
                be undone.
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

export function ProjectList({
  onOpenProject,
  onUploaded,
}: {
  onOpenProject: (id: string) => void;
  onUploaded: (projectId: string) => void;
}) {
  const { data, isLoading, isError, error } = useProjects();
  const [query, setQuery] = useState("");
  const { t } = useTranslation();

  const filtered = useMemo(() => {
    if (!data?.projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.projects;
    return data.projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.fileName.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{t("projects.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("projects.subtitle")}
        </p>
        {/* Capability strip */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {[
            { emoji: "📱", label: "Android APK" },
            { emoji: "🌐", label: "Web Apps" },
            { emoji: "⚙️", label: "CLI Binaries" },
            { emoji: "🐳", label: "Docker Images" },
            { emoji: "🧪", label: "Test Suites" },
            { emoji: "🔒", label: "Security Audits" },
            { emoji: "🚀", label: "Deployments" },
            { emoji: "📦", label: "Releases" },
          ].map((cap) => (
            <span
              key={cap.label}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              <span aria-hidden>{cap.emoji}</span>
              {cap.label}
            </span>
          ))}
        </div>
      </header>

      {/* AI Assistant — the key differentiator */}
      <AIAssistant
        onNavigate={(target) => {
          if (target === "docs") {
            window.open("https://nextjs.org", "_blank");
          }
        }}
        onOpenProject={onOpenProject}
      />

      {/* Global stats dashboard — shows the system is alive */}
      <SystemStatsDashboard />

      <ForgeDropzone onUploaded={onUploaded} />

      {/* Git import — clone from URL */}
      <GitImport onImported={onOpenProject} />

      {/* AI Script Generator */}
      <ScriptGenerator />

      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            {filtered.length
              ? `${filtered.length} project${filtered.length === 1 ? "" : "s"}${query ? ` matching "${query}"` : ""}`
              : query
                ? `No projects matching "${query}"`
                : "No projects yet"}
          </h3>
          {data && data.projects.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                placeholder="Search projects…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-56"
                aria-label="Search projects"
              />
            </div>
          )}
        </div>

        {isError ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load projects: {error?.message}
            </CardContent>
          </Card>
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
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={onOpenProject}
              />
            ))}
          </motion.div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="size-5" aria-hidden />
              </div>
              <p className="text-sm font-medium">No projects yet</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Upload your first ZIP above and Forge will detect its kind and
                suggest workflows you can run.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
