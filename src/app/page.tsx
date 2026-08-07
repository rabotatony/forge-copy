"use client";

import { useCallback, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Anvil,
  Heart,
  Command,
  FolderGit2,
  Library,
  Settings,
} from "lucide-react";
import { ErrorBoundary, SectionErrorBoundary } from "@/components/forge/error-boundary";
import { ThemeToggle } from "@/components/forge/theme-toggle";
import { CommandPalette } from "@/components/forge/command-palette";
import { useTranslation } from "@/components/forge/use-translation";

// Lazy-load heavy views to reduce initial bundle + memory pressure.
const GlobalDashboard = dynamic(() => import("@/components/forge/global-dashboard").then((m) => m.GlobalDashboard), { ssr: false });
const ProjectList = dynamic(
  () => import("@/components/forge/project-list").then((m) => m.ProjectList),
  { ssr: false },
);
const ProjectWorkspace = dynamic(
  () => import("@/components/forge/project-workspace").then((m) => m.ProjectWorkspace),
  { ssr: false },
);
const RunView = dynamic(
  () => import("@/components/forge/run-view").then((m) => m.RunView),
  { ssr: false },
);
const PipelineRunView = dynamic(
  () => import("@/components/forge/pipeline-run-view").then((m) => m.PipelineRunView),
  { ssr: false },
);
const LibraryView = dynamic(
  () => import("@/components/forge/library").then((m) => m.LibraryView),
  { ssr: false },
);
const SystemConsole = dynamic(
  () => import("@/components/forge/system-console").then((m) => m.SystemConsole),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// View model — 3 surfaces + project-scoped sub-views
// ---------------------------------------------------------------------------

type Surface = "projects" | "library" | "system";

type View =
  | { kind: "surface"; surface: Surface }
  | { kind: "project"; projectId: string }
  | { kind: "run"; projectId: string; runId: string }
  | { kind: "pipeline-run"; projectId: string; pipelineRunId: string };


function parseHash(): View {
  if (typeof window === "undefined") return { kind: "surface", surface: "projects" };
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "surface", surface: "projects" };
  if (parts[0] === "library") return { kind: "surface", surface: "library" };
  if (parts[0] === "system") return { kind: "surface", surface: "system" };
  if (parts[0] === "projects" && parts[1]) {
    const projectId = parts[1];
    if (parts[2] === "runs" && parts[3]) return { kind: "run", projectId, runId: parts[3] };
    if (parts[2] === "pipelines" && parts[3]) return { kind: "pipeline-run", projectId, pipelineRunId: parts[3] };
    return { kind: "project", projectId };
  }
  return { kind: "surface", surface: "projects" };
}
function viewToHash(view: View) {
  switch (view.kind) {
    case "surface": return `#/${view.surface === "projects" ? "" : view.surface}`;
    case "project": return `#/projects/${view.projectId}`;
    case "run": return `#/projects/${view.projectId}/runs/${view.runId}`;
    case "pipeline-run": return `#/projects/${view.projectId}/pipelines/${view.pipelineRunId}`;
  }
}

export default function ForgePage() {
  const [view, setView] = useState<View>(() => parseHash());
  const [cmdOpen, setCmdOpen] = useState(false);
  const { t, locale, rtl } = useTranslation();

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = locale;
    }
  }, [rtl, locale]);

  useEffect(() => { if (typeof window !== "undefined") { const hash = viewToHash(view); if (window.location.hash !== hash) window.history.pushState(null, "", hash || "#/"); } }, [view]);
  useEffect(() => { if (typeof window === "undefined") return; const onPop = () => setView(parseHash()); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);

  // Wire the dashboard "Quick Actions" buttons (upload / marketplace / settings).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onQuick = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (action === "settings") setView({ kind: "surface", surface: "system" });
      else if (action === "marketplace") setView({ kind: "surface", surface: "library" });
      else if (action === "upload") {
        setView({ kind: "surface", surface: "projects" });
        setTimeout(() => window.dispatchEvent(new CustomEvent("forge:open-upload")), 120);
      }
    };
    window.addEventListener("forge:quick-action", onQuick);
    return () => window.removeEventListener("forge:quick-action", onQuick);
  }, []);
  const openProject = useCallback((projectId: string) => {
    setView({ kind: "project", projectId });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const openRun = useCallback((runId: string) => {
    setView((prev) =>
      prev.kind === "project" || prev.kind === "run" || prev.kind === "pipeline-run"
        ? { kind: "run", projectId: prev.projectId, runId }
        : prev,
    );
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const openPipelineRun = useCallback((pipelineRunId: string) => {
    setView((prev) =>
      prev.kind === "project"
        ? { kind: "pipeline-run", projectId: prev.projectId, pipelineRunId }
        : prev,
    );
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const backToProjects = useCallback(() => {
    setView({ kind: "surface", surface: "projects" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const backToProject = useCallback(() => {
    setView((prev) =>
      prev.kind === "run" || prev.kind === "pipeline-run"
        ? { kind: "project", projectId: prev.projectId }
        : prev,
    );
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const goToSurface = useCallback((surface: Surface) => {
    setView({ kind: "surface", surface });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  // Determine which surface is active for nav highlighting.
  const activeSurface: Surface =
    view.kind === "surface" ? view.surface : "projects";

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={backToProjects}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
            aria-label={t("header.home")}
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Anvil className="size-4" aria-hidden />
            </span>
            <span className="text-base font-semibold tracking-tight">
              {t("app.name")}
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              · {t("app.tagline")}
            </span>
          </button>

          <nav className="ml-2 flex items-center gap-0.5" aria-label="Global navigation">
            <NavButton
              icon={FolderGit2}
              label="Projects"
              active={activeSurface === "projects"}
              onClick={() => goToSurface("projects")}
            />
            <NavButton
              icon={Library}
              label="Library"
              active={activeSurface === "library"}
              onClick={() => goToSurface("library")}
            />
            <NavButton
              icon={Settings}
              label="System"
              active={activeSurface === "system"}
              onClick={() => goToSurface("system")}
            />
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="hidden items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
              aria-label="Open command palette"
            >
              <Command className="size-3.5" aria-hidden />
              <span>Search</span>
              <kbd className="ml-1 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                ⌘K
              </kbd>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <ErrorBoundary label="Forge main content">
          {view.kind === "surface" && view.surface === "projects" && (
            <div className="space-y-6">
              <SectionErrorBoundary label="Dashboard"><GlobalDashboard onOpenProject={openProject} /></SectionErrorBoundary>
              <SectionErrorBoundary label="Projects">
                <ProjectList onOpenProject={openProject} onUploaded={openProject} />
              </SectionErrorBoundary>
            </div>
          )}
          {view.kind === "surface" && view.surface === "library" && (
            <SectionErrorBoundary label="Library">
              <LibraryView onCreateFromTemplate={openProject} />
            </SectionErrorBoundary>
          )}
          {view.kind === "surface" && view.surface === "system" && (
            <SectionErrorBoundary label="System">
              <SystemConsole />
            </SectionErrorBoundary>
          )}
          {view.kind === "project" && (
            <SectionErrorBoundary label="Project workspace">
              <ProjectWorkspace
                projectId={view.projectId}
                onBack={backToProjects}
                onOpenRun={openRun}
                onOpenPipelineRun={openPipelineRun}
              />
            </SectionErrorBoundary>
          )}
          {view.kind === "run" && (
            <SectionErrorBoundary label="Run view">
              <RunView runId={view.runId} onBack={backToProject} onOpenRun={openRun} />
            </SectionErrorBoundary>
          )}
          {view.kind === "pipeline-run" && (
            <SectionErrorBoundary label="Pipeline run view">
              <PipelineRunView
                pipelineRunId={view.pipelineRunId}
                onBack={backToProject}
                onOpenRun={openRun}
              />
            </SectionErrorBoundary>
          )}
        </ErrorBoundary>
      </main>

      <footer className="mt-auto border-t border-border bg-background/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2">
            <Anvil className="size-3.5 text-emerald-500" aria-hidden />
            <span>
              <strong className="font-medium text-foreground">{t("app.name")}</strong>{" "}
              · {t("app.description")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>{t("footer.built_with")}</span>
            <Heart className="size-3 fill-red-500 text-red-500" aria-hidden />
            <span>Next.js · TanStack Query · SSE</span>
          </div>
        </div>
      </footer>

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onOpenProject={openProject}
      />
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof FolderGit2;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
