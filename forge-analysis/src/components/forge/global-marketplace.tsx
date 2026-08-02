"use client";

// ============================================================
// Forge — Global Workflow Marketplace page component
// ============================================================
// A project-agnostic view of the workflow template catalog.
// Unlike MarketplaceBrowser (which is scoped to a single project
// and imports immediately on click), this component lets the
// user pick which project to import into via a per-card dropdown.
//
// Data sources:
//   GET /api/forge/marketplace  → { workflows: MarketplaceWorkflow[] }
//   GET /api/forge/projects     → { projects:  ProjectSummary[]   }
//
// Import target:
//   POST /api/forge/projects/[id]/custom-workflows/import
//   body: { workflow: { name, description?, steps, env? } }
//
// Accent color is emerald throughout — never indigo or blue.
// ============================================================

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Store,
  Search,
  Download,
  Loader2,
  Package,
  FolderGit2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  MarketplaceCategory,
  MarketplaceStep,
  MarketplaceWorkflow,
} from "@/lib/forge/marketplace";

// ---------------------------------------------------------------------------
// Types — mirror the API response shapes exactly.
// ---------------------------------------------------------------------------

interface MarketplaceListResponse {
  workflows: MarketplaceWorkflow[];
}

interface ProjectSummary {
  id: string;
  name: string;
  fileName: string | null;
  kind: string | null;
  runCount: number;
  lastRunStatus: string | null;
}

interface ProjectsListResponse {
  projects: ProjectSummary[];
}

/** Body shape accepted by the import endpoint. */
interface ImportPayload {
  workflow: {
    name: string;
    description?: string;
    steps: MarketplaceStep[];
    env?: Record<string, string>;
  };
}

// All selectable categories including the synthetic "all".
type CategoryFilter = "all" | MarketplaceCategory;

const CATEGORY_ORDER: MarketplaceCategory[] = [
  "Build",
  "Test",
  "Deploy",
  "Security",
  "Utility",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GlobalMarketplace — top-level page that renders the full workflow
 * template catalog with category chips, a search field, and per-card
 * "Import into project" dropdowns. Does not take a project prop;
 * the user selects the destination project at import time.
 */
export function GlobalMarketplace() {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");

  // ----- Fetch the marketplace catalog --------------------------------
  const {
    data: marketData,
    isLoading: marketLoading,
    isError: marketError,
    error: marketErr,
  } = useQuery({
    queryKey: ["forge", "marketplace", "global"],
    queryFn: async () => {
      const r = await fetch("/api/forge/marketplace");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? `Marketplace fetch failed (${r.status})`,
        );
      }
      return (await r.json()) as MarketplaceListResponse;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // ----- Fetch the project list (import targets) ----------------------
  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["forge", "projects", "for-import"],
    queryFn: async () => {
      const r = await fetch("/api/forge/projects");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? `Projects fetch failed (${r.status})`,
        );
      }
      return (await r.json()) as ProjectsListResponse;
    },
    staleTime: 60_000,
    retry: false,
  });

  // ----- Category counts for the chip bar -----------------------------
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const wf of marketData?.workflows ?? []) {
      counts[wf.category] = (counts[wf.category] ?? 0) + 1;
    }
    return counts;
  }, [marketData]);

  const visibleCategories = useMemo<MarketplaceCategory[]>(() => {
    return CATEGORY_ORDER.filter((c) => (categoryCounts[c] ?? 0) > 0);
  }, [categoryCounts]);

  // ----- Client-side category + text filtering ------------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (marketData?.workflows ?? []).filter((wf) => {
      if (activeCategory !== "all" && wf.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        wf.name.toLowerCase().includes(q) ||
        wf.description.toLowerCase().includes(q) ||
        wf.language.toLowerCase().includes(q) ||
        wf.category.toLowerCase().includes(q)
      );
    });
  }, [marketData, activeCategory, query]);

  const projects = projectsData?.projects ?? [];
  const hasProjects = projects.length > 0;

  // ----- Import handler ------------------------------------------------
  // Each card manages its own importing state via a closure that
  // captures the workflow + the selected project id.
  const handleImport = async (
    wf: MarketplaceWorkflow,
    project: ProjectSummary,
  ): Promise<void> => {
    const payload: ImportPayload = {
      workflow: {
        name: wf.name,
        description: wf.description,
        steps: wf.steps.map((s) => ({ name: s.name, run: s.run })),
        ...(wf.env ? { env: wf.env } : {}),
      },
    };
    const r = await fetch(
      `/api/forge/projects/${project.id}/custom-workflows/import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = (await r.json().catch(() => ({}))) as {
      id?: string;
      error?: string;
    };
    if (!r.ok) {
      throw new Error(body.error ?? `Import failed (${r.status})`);
    }
    toast.success(
      `Imported "${wf.name}" into "${project.name}" (${wf.steps.length} steps).`,
    );
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* ---------------- Header ---------------- */}
      <Card>
        <CardHeader className="gap-3 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="size-4 text-emerald-600 dark:text-emerald-400" />
            Workflow Marketplace
            {marketData?.workflows.length ? (
              <span className="text-xs font-normal text-muted-foreground">
                {marketData.workflows.length} templates
              </span>
            ) : null}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Browse community workflow templates and import them into any of
            your projects. Templates are not tied to a specific project —
            pick one and choose where to install it.
          </p>

          {/* Search + category chips */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates by name or description…"
                className="h-8 pl-8 text-sm"
                aria-label="Search marketplace templates"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <CategoryChip
                label="All"
                count={marketData?.workflows.length ?? 0}
                active={activeCategory === "all"}
                onClick={() => setActiveCategory("all")}
              />
              {visibleCategories.map((c) => (
                <CategoryChip
                  key={c}
                  label={c}
                  count={categoryCounts[c] ?? 0}
                  active={activeCategory === c}
                  onClick={() => setActiveCategory(c)}
                />
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* ----- Empty-project banner ------------------------------ */}
          {!projectsLoading && !hasProjects ? (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm">
              <Package className="size-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-800 dark:text-emerald-200">
                <strong>Upload a project first.</strong>{" "}
                You need at least one project before you can import
                workflow templates.
              </span>
            </div>
          ) : null}

          {/* ----- Loading state ------------------------------------- */}
          {marketLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading marketplace…
            </div>
          ) : marketError ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-red-600 dark:text-red-400">
              <Store className="size-6 opacity-60" />
              <span>
                {marketErr instanceof Error
                  ? marketErr.message
                  : "Failed to load marketplace."}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Package className="size-6 opacity-40" />
              <span>No templates match your filters.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((wf) => (
                <WorkflowCard
                  key={wf.id}
                  wf={wf}
                  projects={projects}
                  hasProjects={hasProjects}
                  projectsLoading={projectsLoading}
                  onImport={handleImport}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border bg-background text-muted-foreground hover:border-emerald-500/30 hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          active
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground/70",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function WorkflowCard({
  wf,
  projects,
  hasProjects,
  projectsLoading,
  onImport,
}: {
  wf: MarketplaceWorkflow;
  projects: ProjectSummary[];
  hasProjects: boolean;
  projectsLoading: boolean;
  onImport: (
    wf: MarketplaceWorkflow,
    project: ProjectSummary,
  ) => Promise<void>;
}) {
  const [importingProjectId, setImportingProjectId] = useState<string | null>(
    null,
  );

  const handlePickProject = async (project: ProjectSummary): Promise<void> => {
    if (importingProjectId !== null) return;
    setImportingProjectId(project.id);
    try {
      await onImport(wf, project);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : `Failed to import "${wf.name}".`,
      );
    } finally {
      setImportingProjectId(null);
    }
  };

  const importing = importingProjectId !== null;

  return (
    <div className="group flex h-full flex-col rounded-lg border bg-card p-4 transition-all hover:border-emerald-500/30 hover:shadow-md">
      {/* Header: emoji + name + badges */}
      <div className="flex items-start gap-2.5">
        <span className="text-2xl leading-none" aria-hidden>
          {wf.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{wf.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
            >
              {wf.category}
            </Badge>
            <Badge variant="outline" className="px-1.5 text-[10px]">
              {wf.language}
            </Badge>
            <Badge variant="secondary" className="px-1.5 text-[10px]">
              {wf.steps.length}{" "}
              {wf.steps.length === 1 ? "step" : "steps"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 line-clamp-3 text-xs text-muted-foreground">
        {wf.description}
      </p>

      {/* Step preview */}
      <div className="mt-3 space-y-1">
        {wf.steps.slice(0, 3).map((s, i) => (
          <div
            key={`${wf.id}-step-${i}`}
            className="flex items-center gap-1.5 text-[11px]"
          >
            <span className="font-mono text-emerald-600 dark:text-emerald-400">
              {i + 1}.
            </span>
            <code className="truncate font-mono text-muted-foreground">
              {s.name}
            </code>
          </div>
        ))}
        {wf.steps.length > 3 ? (
          <div className="text-[10px] text-muted-foreground/70">
            +{wf.steps.length - 3} more
          </div>
        ) : null}
      </div>

      {/* Footer: env hint + import dropdown */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="text-[10px] text-muted-foreground">
          {wf.env
            ? `${Object.keys(wf.env).length} env var${Object.keys(wf.env).length === 1 ? "" : "s"}`
            : "no env"}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              disabled={importing || projectsLoading || !hasProjects}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {importing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Download className="size-3.5" />
                  Import
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FolderGit2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Import into project…
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projects.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No projects available.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={(e) => {
                      e.preventDefault();
                      void handlePickProject(p);
                    }}
                    disabled={importing}
                    className="flex items-center gap-2 text-xs"
                  >
                    <FolderGit2 className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{p.name}</span>
                    {importingProjectId === p.id ? (
                      <Loader2 className="ml-auto size-3 animate-spin text-emerald-600 dark:text-emerald-400" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
