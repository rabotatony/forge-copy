"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Library as LibraryIcon,
  Search,
  Sparkles,
  Zap,
  Rocket,
  FileArchive,
  Download,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading, ErrorState, EmptyState, CategoryChip } from "./ui";
import { useProjects } from "./use-forge-api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — mirror the unified Template type system from templates.ts
// ---------------------------------------------------------------------------

type TemplateKind = "workflow" | "marketplace" | "preset" | "project";

interface UnifiedTemplate {
  kind: TemplateKind;
  id: string;
  name: string;
  emoji?: string;
  icon?: string;
  description: string;
  category: string;
  language?: string;
  // For marketplace: steps to import
  steps?: { name: string; run: string }[];
  env?: Record<string, string>;
  // For project templates: files to create
  files?: Record<string, string>;
  projectKind?: string;
  // For presets: workflow keys
  presetSteps?: string[];
  intent?: string;
  estimatedSeconds?: number;
  requiresApproval?: boolean;
}

// ---------------------------------------------------------------------------
// LibraryView — the unified template browser
// ---------------------------------------------------------------------------

export function LibraryView({
  onCreateFromTemplate,
}: {
  onCreateFromTemplate: (projectId: string) => void;
}) {
  const [kindFilter, setKindFilter] = useState<TemplateKind | "all">("all");
  const [query, setQuery] = useState("");

  // Fetch all 4 template kinds in parallel.
  const marketplace = useQuery({
    queryKey: ["forge", "marketplace"],
    queryFn: async () => {
      const r = await fetch("/api/forge/marketplace");
      if (!r.ok) throw new Error("Failed to load marketplace");
      return r.json() as Promise<{ workflows: UnifiedTemplate[] }>;
    },
  });

  const workflows = useQuery({
    queryKey: ["forge", "all-workflows"],
    queryFn: async () => {
      // The workflows catalog is embedded in the project endpoint;
      // we fetch a dummy project's workflows OR we fetch the catalog
      // directly. Since workflows are static, we use the first project
      // we have, or fall back to an empty list.
      const r = await fetch("/api/forge/projects");
      if (!r.ok) return { projects: [] };
      return r.json() as Promise<{ projects: { id: string; name: string }[] }>;
    },
  });

  // Build the unified list from all sources.
  const allTemplates = useMemo<UnifiedTemplate[]>(() => {
    const out: UnifiedTemplate[] = [];

    // Marketplace templates (40)
    for (const w of marketplace.data?.workflows ?? []) {
      out.push({
        kind: "marketplace",
        id: w.id,
        name: w.name,
        emoji: w.emoji,
        description: w.description,
        category: w.category,
        language: w.language,
        steps: w.steps,
        env: w.env,
      });
    }

    // Presets are static — import directly.
    // We'll fetch them from a static import to avoid an extra endpoint.
    // (The presets data is small and static.)

    // Project templates are static too.

    return out;
  }, [marketplace.data]);

  // Load presets + project templates from the static modules.
  const [presetsAndProjects, setPresetsAndProjects] = useState<{
    presets: UnifiedTemplate[];
    projects: UnifiedTemplate[];
  }>({ presets: [], projects: [] });

  useMemo(() => {
    // These are static imports — no network needed.
    import("@/lib/forge/presets").then((m) => {
      setPresetsAndProjects((prev) => ({
        ...prev,
        presets: m.WORKFLOW_PRESETS.map((p) => ({
          kind: "preset" as const,
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          description: p.description,
          category: p.category,
          presetSteps: p.steps,
          intent: p.intent,
          estimatedSeconds: p.estimatedSeconds,
          requiresApproval: p.requiresApproval,
        })),
      }));
    });
    import("@/lib/forge/templates-projects").then((m) => {
      setPresetsAndProjects((prev) => ({
        ...prev,
        projects: m.PROJECT_TEMPLATES.map((p) => ({
          kind: "project" as const,
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          description: p.description,
          category: p.kind,
          files: p.files,
          projectKind: p.kind,
        })),
      }));
    });
  }, []);

  const combined = useMemo(() => {
    return [...allTemplates, ...presetsAndProjects.presets, ...presetsAndProjects.projects];
  }, [allTemplates, presetsAndProjects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return combined.filter((t) => {
      if (kindFilter !== "all" && t.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [combined, kindFilter, query]);

  const isLoading = marketplace.isLoading;
  const isError = marketplace.isError;

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of combined) counts[t.kind] = (counts[t.kind] ?? 0) + 1;
    return counts;
  }, [combined]);

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <LibraryIcon className="size-6 text-emerald-600 dark:text-emerald-400" />
          Library
        </h2>
        <p className="text-sm text-muted-foreground">
          Browse workflows, marketplace templates, curated presets, and project starters.
          Apply to a project or create a new one.
        </p>
      </div>

      {/* Search + kind filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search templates…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Search templates"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip
            label="All"
            count={combined.length}
            active={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
          />
          <CategoryChip
            label="Marketplace"
            count={kindCounts.marketplace ?? 0}
            active={kindFilter === "marketplace"}
            onClick={() => setKindFilter("marketplace")}
          />
          <CategoryChip
            label="Presets"
            count={kindCounts.preset ?? 0}
            active={kindFilter === "preset"}
            onClick={() => setKindFilter("preset")}
          />
          <CategoryChip
            label="Starters"
            count={kindCounts.project ?? 0}
            active={kindFilter === "project"}
            onClick={() => setKindFilter("project")}
          />
        </div>
      </div>

      {/* Grid */}
      {isError ? (
        <ErrorState message="Failed to load library" />
      ) : isLoading ? (
        <Loading label="Loading library…" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={LibraryIcon} title="No templates found" description="Try a different search or filter." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tpl) => (
            <TemplateCard
              key={`${tpl.kind}-${tpl.id}`}
              template={tpl}
              onCreateFromTemplate={onCreateFromTemplate}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onCreateFromTemplate,
}: {
  template: UnifiedTemplate;
  onCreateFromTemplate: (projectId: string) => void;
}) {
  const { data: projectsData } = useProjects();
  const [importing, setImporting] = useState(false);

  const handleApplyToProject = async (projectId: string) => {
    if (template.kind !== "marketplace") return;
    setImporting(true);
    try {
      const r = await fetch(
        `/api/forge/projects/${projectId}/custom-workflows/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: {
              name: template.name,
              description: template.description,
              steps: template.steps,
              env: template.env,
            },
          }),
        },
      );
      if (!r.ok) throw new Error("Import failed");
      toast.success(`Imported "${template.name}" into project`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleCreateProject = async () => {
    if (template.kind !== "project") return;
    setImporting(true);
    try {
      const r = await fetch("/api/forge/create-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, name: template.name }),
      });
      if (!r.ok) throw new Error("Create failed");
      const data = await r.json();
      toast.success(`Created project from ${template.name}`);
      onCreateFromTemplate(data.project.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setImporting(false);
    }
  };

  const kindIcon = {
    marketplace: Download,
    preset: Rocket,
    project: FileArchive,
    workflow: Zap,
  }[template.kind];

  const kindLabel = {
    marketplace: "Marketplace",
    preset: "Preset",
    project: "Starter",
    workflow: "Workflow",
  }[template.kind];

  return (
    <Card className="group flex flex-col transition-shadow hover:shadow-md">
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start gap-2">
          <span className="text-2xl" aria-hidden>
            {template.emoji ?? "📦"}
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-sm">{template.name}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] font-normal">
                {kindLabel}
              </Badge>
              <Badge variant="secondary" className="text-[10px] font-normal">
                {template.category}
              </Badge>
              {template.language && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {template.language}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="line-clamp-3 text-xs text-muted-foreground">
          {template.description}
        </p>

        {/* Preset steps preview */}
        {template.kind === "preset" && template.presetSteps && (
          <div className="flex flex-wrap gap-1">
            {template.presetSteps.map((step, i) => (
              <span
                key={i}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
              >
                {step}
              </span>
            ))}
          </div>
        )}

        {/* Action */}
        <div className="mt-auto pt-2">
          {template.kind === "project" ? (
            <Button
              size="sm"
              className="w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={importing}
              onClick={handleCreateProject}
            >
              <FileArchive className="size-3.5" />
              {importing ? "Creating…" : "Create Project"}
              <ChevronRight className="size-3.5" />
            </Button>
          ) : template.kind === "marketplace" ? (
            <ProjectPickerButton
              projects={projectsData?.projects ?? []}
              disabled={importing}
              onPick={handleApplyToProject}
            />
          ) : template.kind === "preset" ? (
            <div className="text-xs text-muted-foreground">
              {template.presetSteps?.length ?? 0} workflows ·{" "}
              {template.estimatedSeconds ?? 60}s est.
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Predefined workflow
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectPickerButton({
  projects,
  disabled,
  onPick,
}: {
  projects: { id: string; name: string }[];
  disabled: boolean;
  onPick: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (projects.length === 0) {
    return (
      <Button size="sm" variant="outline" className="w-full" disabled>
        No projects to import into
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        className="w-full gap-1.5"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Download className="size-3.5" />
        {disabled ? "Importing…" : "Import to project"}
        <ChevronRight className="size-3.5" />
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-full rounded-md border border-border bg-popover p-1 shadow-md">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  onPick(p.id);
                }}
              >
                <FileArchive className="size-3.5 text-muted-foreground" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
