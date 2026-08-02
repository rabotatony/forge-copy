"use client";

import { useCallback, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Anvil, Github, Heart, Command, LayoutDashboard, FolderGit2, Store, Settings, FlaskConical } from "lucide-react";
import { ProjectList } from "@/components/forge/project-list";
import {
  ErrorBoundary,
  SectionErrorBoundary,
} from "@/components/forge/error-boundary";
import { ThemeToggle } from "@/components/forge/theme-toggle";
import { CommandPalette } from "@/components/forge/command-palette";
import { useTranslation } from "@/components/forge/use-translation";

// Lazy-load heavy views to reduce initial bundle + memory pressure.
const ProjectDashboard = dynamic(
  () => import("@/components/forge/project-dashboard").then((m) => m.ProjectDashboard),
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

type View =
  | { kind: "list" }
  | { kind: "dashboard" }
  | { kind: "marketplace" }
  | { kind: "settings" }
  | { kind: "lab" }
  | { kind: "project"; projectId: string }
  | { kind: "run"; projectId: string; runId: string }
  | { kind: "pipeline-run"; projectId: string; pipelineRunId: string };

// Lazy-load global pages.
const GlobalDashboard = dynamic(() => import("@/components/forge/global-dashboard").then(m => ({ default: m.GlobalDashboard })), { ssr: false });
const GlobalMarketplace = dynamic(() => import("@/components/forge/global-marketplace").then(m => ({ default: m.GlobalMarketplace })), { ssr: false });
const GlobalSettings = dynamic(() => import("@/components/forge/global-settings").then(m => ({ default: m.GlobalSettings })), { ssr: false });
const ExperimentsLab = dynamic(() => import("@/components/forge/experiments-lab").then(m => ({ default: m.ExperimentsLab })), { ssr: false });

export default function ForgePage() {
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [cmdOpen, setCmdOpen] = useState(false);
  const { t, locale, rtl } = useTranslation();

  // Apply RTL direction to the document when locale is Hebrew.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = locale;
    }
  }, [rtl, locale]);

  // Listen for quick-action events from GlobalDashboard.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ action: string }>).detail;
      if (detail?.action === "upload") setView({ kind: "list" });
      else if (detail?.action === "marketplace") setView({ kind: "marketplace" });
      else if (detail?.action === "settings") setView({ kind: "settings" });
    };
    window.addEventListener("forge:quick-action", handler);
    return () => window.removeEventListener("forge:quick-action", handler);
  }, []);

  const openProject = useCallback((projectId: string) => {
    setView({ kind: "project", projectId });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const openRun = useCallback(
    (runId: string) => {
      if (view.kind === "project" || view.kind === "pipeline-run") {
        setView({ kind: "run", projectId: view.projectId, runId });
        if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      }
    },
    [view],
  );

  const openPipelineRun = useCallback(
    (pipelineRunId: string) => {
      if (view.kind !== "project") return;
      setView({ kind: "pipeline-run", projectId: view.projectId, pipelineRunId });
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    },
    [view],
  );

  const backToList = useCallback(() => {
    setView({ kind: "list" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const backToProject = useCallback(() => {
    if (view.kind === "run" || view.kind === "pipeline-run") {
      setView({ kind: "project", projectId: view.projectId });
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    }
  }, [view]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={backToList}
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

          <nav
            className="ml-2 flex items-center gap-0.5"
            aria-label="Global navigation"
          >
            <NavButton icon={LayoutDashboard} label="Dashboard" active={view.kind === "dashboard"} onClick={() => setView({ kind: "dashboard" })} />
            <NavButton icon={FolderGit2} label="Projects" active={view.kind === "list" || view.kind === "project" || view.kind === "run" || view.kind === "pipeline-run"} onClick={() => setView({ kind: "list" })} />
            <NavButton icon={Store} label="Marketplace" active={view.kind === "marketplace"} onClick={() => setView({ kind: "marketplace" })} />
            <NavButton icon={FlaskConical} label="Lab" active={view.kind === "lab"} onClick={() => setView({ kind: "lab" })} />
            <NavButton icon={Settings} label="Settings" active={view.kind === "settings"} onClick={() => setView({ kind: "settings" })} />
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
            <a
              href="https://nextjs.org"
              target="_blank"
              rel="noreferrer noopener"
              className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
            >
              <Github className="size-3.5" aria-hidden />
              Docs
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <ErrorBoundary label="Forge main content">
          {view.kind === "dashboard" && (
            <SectionErrorBoundary label="Dashboard">
              <GlobalDashboard />
            </SectionErrorBoundary>
          )}
          {view.kind === "marketplace" && (
            <SectionErrorBoundary label="Marketplace">
              <GlobalMarketplace />
            </SectionErrorBoundary>
          )}
          {view.kind === "settings" && (
            <SectionErrorBoundary label="Settings">
              <GlobalSettings />
            </SectionErrorBoundary>
          )}
          {view.kind === "lab" && (
            <SectionErrorBoundary label="Experiments Lab">
              <ExperimentsLab />
            </SectionErrorBoundary>
          )}
          {view.kind === "list" && (
            <SectionErrorBoundary label="Project list">
              <ProjectList
                onOpenProject={openProject}
                onUploaded={openProject}
              />
            </SectionErrorBoundary>
          )}
          {view.kind === "project" && (
            <SectionErrorBoundary label="Project dashboard">
              <ProjectDashboard
                projectId={view.projectId}
                onBack={backToList}
                onOpenRun={openRun}
                onOpenPipelineRun={openPipelineRun}
              />
            </SectionErrorBoundary>
          )}
          {view.kind === "run" && (
            <SectionErrorBoundary label="Run view">
              <RunView runId={view.runId} onBack={backToProject} />
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
            <Anvil
              className="size-3.5 text-emerald-500"
              aria-hidden
            />
            <span>
              <strong className="font-medium text-foreground">{t("app.name")}</strong>{" "}
              · {t("app.description")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>{t("footer.built_with")}</span>
            <Heart
              className="size-3 fill-red-500 text-red-500"
              aria-hidden
            />
            <span>
              Next.js · TanStack Query · SSE
            </span>
          </div>
        </div>
      </footer>

      {/* Command palette overlay (Cmd+K / Ctrl+K) */}
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onOpenProject={openProject}
      />
    </div>
  );
}

function NavButton({ icon: Icon, label, active, onClick }: { icon: typeof LayoutDashboard; label: string; active: boolean; onClick: () => void }) {
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
