"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Store, Search, Download, Loader2 } from "lucide-react";
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
import type {
  MarketplaceCategory,
  MarketplaceStep,
  MarketplaceWorkflow,
} from "@/lib/forge/marketplace";

// ---------------------------------------------------------------------------
// Types — mirror the API response shape exactly.
// ---------------------------------------------------------------------------

interface MarketplaceListResponse {
  workflows: MarketplaceWorkflow[];
}

// Inline re-declaration of the step shape so the import payload stays
// self-contained and the API contract is obvious at the call site.
interface ImportPayload {
  workflow: {
    name: string;
    description?: string;
    steps: MarketplaceStep[];
    env?: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * MarketplaceBrowser — browsable catalog of community workflow
 * templates. Each card shows the template metadata (emoji, name,
 * description, category + language + step-count badges) and an
 * "Import to project" button that POSTs the template to the project's
 * custom-workflow import route.
 *
 * Accent color is emerald throughout — no indigo or blue is used.
 */
export function MarketplaceBrowser({ projectId }: { projectId: string }) {
  const [activeCategory, setActiveCategory] = useState<"all" | MarketplaceCategory>("all");
  const [query, setQuery] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "marketplace"],
    queryFn: async () => {
      const r = await fetch("/api/forge/marketplace");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Marketplace fetch failed (${r.status})`);
      }
      return (await r.json()) as MarketplaceListResponse;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Build the per-category counts and ordered list of categories so
  // chips can be rendered with a "(N)" badge next to each label.
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const wf of data?.workflows ?? []) {
      counts[wf.category] = (counts[wf.category] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const categories = useMemo<MarketplaceCategory[]>(() => {
    const order: MarketplaceCategory[] = ["Build", "Test", "Deploy", "Security", "Utility"];
    return order.filter((c) => (categoryCounts[c] ?? 0) > 0);
  }, [categoryCounts]);

  // Apply client-side category + text filters. The dataset is tiny
  // (a dozen templates), so doing this client-side gives instant UX
  // without re-fetching on every chip click.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.workflows ?? []).filter((wf) => {
      if (activeCategory !== "all" && wf.category !== activeCategory) return false;
      if (!q) return true;
      return (
        wf.name.toLowerCase().includes(q) ||
        wf.description.toLowerCase().includes(q) ||
        wf.language.toLowerCase().includes(q) ||
        wf.category.toLowerCase().includes(q)
      );
    });
  }, [data, activeCategory, query]);

  const handleImport = async (wf: MarketplaceWorkflow) => {
    const payload: ImportPayload = {
      workflow: {
        name: wf.name,
        description: wf.description,
        steps: wf.steps.map((s) => ({ name: s.name, run: s.run })),
        ...(wf.env ? { env: wf.env } : {}),
      },
    };
    try {
      const r = await fetch(
        `/api/forge/projects/${projectId}/custom-workflows/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok) {
        throw new Error(body.error ?? `Import failed (${r.status})`);
      }
      toast.success(`Imported "${wf.name}" into project (${wf.steps.length} steps).`);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to import workflow template.",
      );
    }
  };

  return (
    <Card>
      <CardHeader className="gap-3 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="size-4 text-emerald-600 dark:text-emerald-400" />
          Workflow Marketplace
          {data?.workflows.length ? (
            <span className="text-xs font-normal text-muted-foreground">
              {data.workflows.length} templates
            </span>
          ) : null}
        </CardTitle>

        {/* Search + category chips */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              className="h-8 pl-8 text-sm"
              aria-label="Search marketplace templates"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              label="All"
              count={data?.workflows.length ?? 0}
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            />
            {categories.map((c) => (
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
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading marketplace…
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-red-600 dark:text-red-400">
            <Store className="size-6 opacity-60" />
            <span>
              {error instanceof Error ? error.message : "Failed to load marketplace."}
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Store className="size-6 opacity-40" />
            <span>No templates match your filters.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((wf) => (
              <WorkflowCard key={wf.id} wf={wf} onImport={() => void handleImport(wf)} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
          active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/70",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function WorkflowCard({
  wf,
  onImport,
}: {
  wf: MarketplaceWorkflow;
  onImport: () => void;
}) {
  const [importing, setImporting] = useState(false);

  const handleClick = async () => {
    setImporting(true);
    try {
      await onImport();
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="group flex h-full flex-col rounded-lg border bg-card p-4 transition-all hover:border-emerald-500/30 hover:shadow-md">
      {/* Header: emoji + name */}
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
              {wf.steps.length} {wf.steps.length === 1 ? "step" : "steps"}
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
          <div key={`${wf.id}-step-${i}`} className="flex items-center gap-1.5 text-[11px]">
            <span className="font-mono text-emerald-600 dark:text-emerald-400">{i + 1}.</span>
            <code className="truncate font-mono text-muted-foreground">{s.name}</code>
          </div>
        ))}
        {wf.steps.length > 3 ? (
          <div className="text-[10px] text-muted-foreground/70">
            +{wf.steps.length - 3} more
          </div>
        ) : null}
      </div>

      {/* Footer: import button */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="text-[10px] text-muted-foreground">
          {wf.env ? `${Object.keys(wf.env).length} env var${Object.keys(wf.env).length === 1 ? "" : "s"}` : "no env"}
        </span>
        <Button
          size="sm"
          onClick={() => void handleClick()}
          disabled={importing}
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
      </div>
    </div>
  );
}
