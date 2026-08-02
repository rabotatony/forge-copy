"use client";

import { useState, useMemo } from "react";
import { Search, Lock, Zap, Database, FlaskConical } from "lucide-react";
// Note: framer-motion removed to reduce memory pressure.
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  useProjectWorkflows,
  useStartRun,
  useProjectIntent,
  type FullWorkflow,
} from "./use-forge-api";
import { renderWorkflowIcon } from "./icon-map";
import { WORKFLOW_CATEGORIES, categoryForWorkflow } from "@/lib/forge/categories";

/**
 * WorkflowCatalog — searchable, categorized grid of ALL workflows
 * available for a project. Replaces the flat "suggested workflows"
 * list with a full capability browser.
 *
 * Features:
 *   • Live search by name/description/key
 *   • Category filter chips
 *   • Each card shows: icon, name, description, badges (approval,
 *     cache, test-report, secrets), one-click run
 *   • Highlighted "recommended" workflows from intent detection
 */
export function WorkflowCatalog({
  projectId,
  onRunStarted,
}: {
  projectId: string;
  onRunStarted?: (runId: string) => void;
}) {
  const { data, isLoading } = useProjectWorkflows(projectId);
  const { data: intent } = useProjectIntent(projectId);
  const startRun = useStartRun();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const recommendedSet = useMemo(
    () => new Set(intent?.recommended ?? []),
    [intent],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.workflows.filter((w) => {
      if (activeCategory !== "all" && categoryForWorkflow(w.key) !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.key.toLowerCase().includes(q)
      );
    });
  }, [data, query, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of data?.workflows ?? []) {
      const cat = categoryForWorkflow(w.key);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const handleRun = async (w: FullWorkflow) => {
    try {
      const res = await startRun.mutateAsync({
        projectId,
        workflow: w.key,
      });
      toast.success(`Started "${w.name}"`);
      onRunStarted?.(res.runId);
    } catch (e) {
      toast.error(
        `Failed to start: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading workflows…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          placeholder="Search 33 workflows by name, description, or key…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          aria-label="Search workflows"
        />
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryChip
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
          emoji="✨"
          label="All"
          count={data?.workflows.length ?? 0}
        />
        {WORKFLOW_CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.id] ?? 0;
          if (count === 0) return null;
          return (
            <CategoryChip
              key={cat.id}
              active={activeCategory === cat.id}
              onClick={() => setActiveCategory(cat.id)}
              emoji={cat.emoji}
              label={cat.label}
              count={count}
            />
          );
        })}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} workflow{filtered.length === 1 ? "" : "s"}
          {activeCategory !== "all" && " in this category"}
          {query && ` matching "${query}"`}
        </span>
      </div>

      {/* Workflow grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((w) => {
          const isRecommended = recommendedSet.has(w.key);
          const isPrimary = intent?.primary === w.key;
          return (
            <WorkflowCard
              key={w.key}
              workflow={w}
              isRecommended={isRecommended}
              isPrimary={isPrimary}
              pending={
                startRun.isPending && startRun.variables?.workflow === w.key
              }
              onRun={() => void handleRun(w)}
            />
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <Search className="size-6 opacity-40" aria-hidden />
          <span>No workflows match your search.</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setActiveCategory("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  emoji,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-emerald-500/20" : "bg-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function WorkflowCard({
  workflow,
  isRecommended,
  isPrimary,
  pending,
  onRun,
}: {
  workflow: FullWorkflow;
  isRecommended: boolean;
  isPrimary: boolean;
  pending: boolean;
  onRun: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl border p-4 transition-all hover:shadow-md",
        isPrimary
          ? "border-emerald-500/50 bg-emerald-500/[0.04]"
          : isRecommended
            ? "border-emerald-500/25 bg-emerald-500/[0.02]"
            : "border-border bg-card hover:border-emerald-500/30",
      )}
    >
      {/* Top: icon + name + badges */}
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            isPrimary
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {renderWorkflowIcon(workflow.icon, "size-5")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{workflow.name}</h3>
            {isPrimary && (
              <Badge className="shrink-0 bg-emerald-600 px-1.5 text-[10px] text-white">
                <Zap className="mr-0.5 size-2.5" />
                Best match
              </Badge>
            )}
            {isRecommended && !isPrimary && (
              <Badge
                variant="outline"
                className="shrink-0 border-emerald-500/40 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
              >
                Recommended
              </Badge>
            )}
          </div>
          <code className="text-[10px] text-muted-foreground">{workflow.key}</code>
        </div>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {workflow.description}
      </p>

      {/* Feature badges */}
      <div className="flex flex-wrap gap-1">
        {workflow.requiresApproval && (
          <Badge variant="outline" className="gap-1 px-1.5 text-[10px] text-amber-600 dark:text-amber-400">
            <Lock className="size-2.5" />
            Approval
          </Badge>
        )}
        {workflow.cache && (
          <Badge variant="outline" className="gap-1 px-1.5 text-[10px]">
            <Database className="size-2.5" />
            Cache
          </Badge>
        )}
        {workflow.testReport && (
          <Badge variant="outline" className="gap-1 px-1.5 text-[10px]">
            <FlaskConical className="size-2.5" />
            Tests
          </Badge>
        )}
        {workflow.secrets.length > 0 && (
          <Badge variant="outline" className="gap-1 px-1.5 text-[10px]">
            {workflow.secrets.length} secret{workflow.secrets.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      {/* Run button */}
      <Button
        size="sm"
        onClick={onRun}
        disabled={pending}
        className={cn(
          "mt-auto w-full",
          isPrimary
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-background text-foreground hover:bg-accent",
        )}
      >
        {pending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <Zap className="size-3.5" />
            Run
          </>
        )}
      </Button>
    </div>
  );
}
