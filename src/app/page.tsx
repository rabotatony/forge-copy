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
  LayoutDashboard,
  TerminalSquare,
  Eye,
  Rocket,
  Sparkles,
  Clock,
} from "lucide-react";
import { ErrorBoundary, SectionErrorBoundary } from "@/components/forge/error-boundary";
import { ThemeToggle } from "@/components/forge/theme-toggle";
import { CommandPalette } from "@/components/forge/command-palette";
import { useTranslation } from "@/components/forge/use-translation";

// Lazy-load heavy views to reduce initial bundle + memory pressure.
const GlobalDashboard = dynamic(() => import("@/components/forge/global-dashboard").then((m) => m.GlobalDashboard), { ssr: false });
const ProjectList = dynamic(() => import("@/components/forge/project-list").then((m) => m.ProjectList), { ssr: false });
const ProjectWorkspace = dynamic(() => import("@/components/forge/project-workspace").then((m) => m.ProjectWorkspace), { ssr: false });
const RunView = dynamic(() => import("@/components/forge/run-view").then((m) => m.RunView), { ssr: false });
const PipelineRunView = dynamic(() => import("@/components/forge/pipeline-run-view").then((m) => m.PipelineRunView), { ssr: false });
const LibraryView = dynamic(() => import("@/components/forge/library").then((m) => m.LibraryView), { ssr: false });
const SystemConsole = dynamic(() => import("@/components/forge/system-console").then((m) => m.SystemConsole), { ssr: false });
const ForgeHero = dynamic(() => import("@/components/forge/forge-hero").then((m) => m.ForgeHero), { ssr: false });

// ---------------------------------------------------------------------------
// View model — 3 surfaces (+ Control Center categories) + project sub-views
// ---------------------------------------------------------------------------
type Surface = "projects" | "library" | "system";
type View =
  | { kind: "landing" }
  | { kind: "surface"; surface: Surface; category?: string }
  | { kind: "project"; projectId: string }
  | { kind: "run"; projectId: string; runId: string }
  | { kind: "pipeline-run"; projectId: string; pipelineRunId: string };

function parseHash(): View {
  if (typeof window === "undefined") return { kind: "surface", surface: "projects" };
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "landing" };
  if (parts[0] === "library") return { kind: "surface", surface: "library" };
  if (parts[0] === "system") return { kind: "surface", surface: "system", category: parts[1] };
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
    case "landing": return "#/";
    case "surface":
      if (view.surface === "system" && view.category) return "#/system/" + view.category;
      return "#/" + (view.surface === "projects" ? "" : view.surface);
    case "project": return "#/projects/" + view.projectId;
    case "run": return "#/projects/" + view.projectId + "/runs/" + view.runId;
    case "pipeline-run": return "#/projects/" + view.projectId + "/pipelines/" + view.pipelineRunId;
  }
}

// Sidebar navigation -------------------------------------------------------
const MAIN_NAV = [
  { surface: "projects", label: "Projects", icon: FolderGit2 },
  { surface: "library", label: "Library", icon: Library },
] as const;

// Control Center categories (ids must match CATS in system-console.tsx)
const CONTROL_NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "execute", label: "Execute", icon: TerminalSquare },
  { id: "observe", label: "Observe", icon: Eye },
  { id: "deploy", label: "Deploy", icon: Rocket },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "automate", label: "Automate", icon: Clock },
  { id: "manage", label: "Manage", icon: Settings },
] as const;

const navBtn = (active: boolean) =>
  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors " +
  (active
    ? "bg-emerald-500/10 font-medium text-emerald-600 dark:text-emerald-400"
    : "text-muted-foreground hover:bg-accent hover:text-foreground");

export default function ForgePage() {
  const [view, setView] = useState<View>({ kind: "landing" });
  const [ready, setReady] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const { t, locale, rtl } = useTranslation();

  // Apply the URL hash after mount (SSR-safe, avoids hydration mismatch).
  useEffect(() => { setView(parseHash()); setReady(true); }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = locale;
    }
  }, [rtl, locale]);

  // Keep the URL hash in sync with the active view.
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const hash = viewToHash(view);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }, [view, ready]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setView(parseHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Wire the dashboard "Quick Actions" buttons.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onQuick = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (action === "settings") setView({ kind: "surface", surface: "system", category: "manage" });
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
      prev.kind === "project" ? { kind: "pipeline-run", projectId: prev.projectId, pipelineRunId } : prev,
    );
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const backToProjects = useCallback(() => {
    setView({ kind: "surface", surface: "projects" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const backToProject = useCallback(() => {
    setView((prev) =>
      prev.kind === "run" || prev.kind === "pipeline-run" ? { kind: "project", projectId: prev.projectId } : prev,
    );
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const goToSurface = useCallback((surface: Surface, category?: string) => {
    setView({ kind: "surface", surface, category });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const activeSurface: Surface = view.kind === "surface" ? view.surface : "projects";
  const isLanding = view.kind === "landing";
  const activeCategory = view.kind === "surface" && view.surface === "system" ? view.category : undefined;

  // ===== Landing page — its own immersive world =====
  if (isLanding) {
    return (
      <ErrorBoundary label="Forge landing">
        <ForgeHero onEnterApp={() => goToSurface("projects")} onOpenControlCenter={() => goToSurface("system", "overview")} />
      </ErrorBoundary>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ===== Desktop sidebar ===== */}
      <aside className="sticky top-0 z-30 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-background/70 backdrop-blur md:flex">
        <button type="button" onClick={backToProjects} className="flex items-center gap-2.5 px-5 py-5 text-left transition-opacity hover:opacity-80">
          <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Anvil className="size-4" aria-hidden />
          </span>
          <span className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">{t("app.name")}</span>
            <span className="text-[11px] text-muted-foreground">{t("app.tagline")}</span>
          </span>
        </button>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="Primary">
          <div className="space-y-0.5">
            {MAIN_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.surface} type="button" onClick={() => goToSurface(item.surface)} className={navBtn(activeSurface === item.surface)}>
                  <Icon className="size-4" aria-hidden />{item.label}
                </button>
              );
            })}
          </div>

          <div>
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Control Center</div>
            <div className="space-y-0.5">
              {CONTROL_NAV.map((item) => {
                const Icon = item.icon;
                const active = activeSurface === "system" && activeCategory === item.id;
                return (
                  <button key={item.id} type="button" onClick={() => goToSurface("system", item.id)} className={navBtn(active)}>
                    <Icon className="size-4" aria-hidden />{item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button type="button" onClick={() => setCmdOpen(true)} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent" aria-label="Open command palette">
            <Command className="size-3.5" aria-hidden /><span>Search</span>
            <kbd className="ml-1 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <ThemeToggle />
        </div>
      </aside>

      {/* ===== Main column ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur md:hidden">
          <button type="button" onClick={backToProjects} className="flex items-center gap-2" aria-label={t("header.home")}>
            <span className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Anvil className="size-4" aria-hidden /></span>
            <span className="text-base font-semibold tracking-tight">{t("app.name")}</span>
          </button>
          <nav className="ml-auto flex items-center gap-1" aria-label="Mobile navigation">
            {MAIN_NAV.map((item) => { const Icon = item.icon; return (
              <button key={item.surface} type="button" onClick={() => goToSurface(item.surface)} aria-label={item.label}
                className={"rounded-md p-2 " + (activeSurface === item.surface ? "bg-emerald-500/10 text-emerald-500" : "text-muted-foreground hover:bg-accent")}>
                <Icon className="size-4" aria-hidden />
              </button>); })}
            <button type="button" onClick={() => goToSurface("system", activeCategory || "overview")} aria-label="Control Center"
              className={"rounded-md p-2 " + (activeSurface === "system" ? "bg-emerald-500/10 text-emerald-500" : "text-muted-foreground hover:bg-accent")}>
              <Settings className="size-4" aria-hidden />
            </button>
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <ErrorBoundary label="Forge main content">
            {view.kind === "surface" && view.surface === "projects" && (
              <div className="mx-auto w-full max-w-6xl space-y-6">
                <div id="projects" className="scroll-mt-20" />
                <SectionErrorBoundary label="Dashboard"><GlobalDashboard onOpenProject={openProject} /></SectionErrorBoundary>
                <SectionErrorBoundary label="Projects"><ProjectList onOpenProject={openProject} onUploaded={openProject} /></SectionErrorBoundary>
              </div>
            )}
            {view.kind === "surface" && view.surface === "library" && (
              <div className="mx-auto w-full max-w-6xl"><SectionErrorBoundary label="Library"><LibraryView onCreateFromTemplate={openProject} /></SectionErrorBoundary></div>
            )}
            {view.kind === "surface" && view.surface === "system" && (
              <SectionErrorBoundary label="Control Center"><SystemConsole category={activeCategory} /></SectionErrorBoundary>
            )}
            {view.kind === "project" && (
              <SectionErrorBoundary label="Project workspace"><ProjectWorkspace projectId={view.projectId} onBack={backToProjects} onOpenRun={openRun} onOpenPipelineRun={openPipelineRun} /></SectionErrorBoundary>
            )}
            {view.kind === "run" && (
              <SectionErrorBoundary label="Run view"><RunView runId={view.runId} onBack={backToProject} onOpenRun={openRun} /></SectionErrorBoundary>
            )}
            {view.kind === "pipeline-run" && (
              <SectionErrorBoundary label="Pipeline run view"><PipelineRunView pipelineRunId={view.pipelineRunId} onBack={backToProject} onOpenRun={openRun} /></SectionErrorBoundary>
            )}
          </ErrorBoundary>
        </main>

        <footer className="mt-auto border-t border-border bg-background/60">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Anvil className="size-3.5 text-emerald-500" aria-hidden />
              <span><strong className="font-medium text-foreground">{t("app.name")}</strong> · {t("app.description")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>{t("footer.built_with")}</span>
              <Heart className="size-3 fill-red-500 text-red-500" aria-hidden />
              <span>Next.js · TanStack Query · SSE</span>
            </div>
          </div>
        </footer>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} onOpenProject={openProject} />
    </div>
  );
}
