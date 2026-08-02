"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, Play, GripVertical, ArrowRight, GitBranch, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useProjectWorkflows, useStartRun } from "./use-forge-api";

interface PipelineStage {
  id: string;
  workflow: string;
  dependsOn: string[];
}

/**
 * VisualPipelineBuilder — drag-free visual pipeline editor.
 * Users add stages, connect them with dependencies, and run.
 * This is Forge's key differentiator: visual pipeline building
 * instead of GitHub Actions YAML.
 */
export function VisualPipelineBuilder({
  projectId,
  onPipelineStarted,
}: {
  projectId: string;
  onPipelineStarted?: (pipelineRunId: string) => void;
}) {
  const { data: wfData, isLoading } = useProjectWorkflows(projectId);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [name, setName] = useState("");
  const startRun = useStartRun();

  const workflows = wfData?.workflows ?? [];

  const addStage = useCallback(() => {
    if (workflows.length === 0) return;
    const id = `stage-${stages.length}`;
    const prevStage = stages[stages.length - 1];
    setStages([
      ...stages,
      {
        id,
        workflow: workflows[0]!.key,
        dependsOn: prevStage ? [prevStage.id] : [],
      },
    ]);
  }, [stages, workflows]);

  const removeStage = useCallback((id: string) => {
    setStages((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      // Update dependencies: remove references to deleted stage.
      return filtered.map((s) => ({
        ...s,
        dependsOn: s.dependsOn.filter((d) => d !== id),
      }));
    });
  }, []);

  const updateStage = useCallback((id: string, workflow: string) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, workflow } : s)));
  }, []);

  const toggleDependency = useCallback((stageId: string, depId: string) => {
    setStages((prev) =>
      prev.map((s) => {
        if (s.id !== stageId) return s;
        const has = s.dependsOn.includes(depId);
        return {
          ...s,
          dependsOn: has ? s.dependsOn.filter((d) => d !== depId) : [...s.dependsOn, depId],
        };
      }),
    );
  }, []);

  const runPipeline = async () => {
    if (stages.length === 0) {
      toast.error("Add at least one stage");
      return;
    }
    // Run each stage sequentially (simple approach — full pipeline API
    // would create a Pipeline record, but this is a quick visual flow).
    const pipelineName = name.trim() || `Pipeline: ${stages.map((s) => s.workflow).join(" → ")}`;
    toast.info(`Starting pipeline: ${pipelineName}`);

    for (const stage of stages) {
      try {
        const result = await startRun.mutateAsync({
          projectId,
          workflow: stage.workflow,
        });
        toast.success(`Stage ${stage.workflow} started (run ${result.runId.slice(-8)})`);
      } catch (e) {
        toast.error(`Stage ${stage.workflow} failed: ${e instanceof Error ? e.message : "unknown"}`);
        break;
      }
    }
    onPipelineStarted?.("");
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading workflows…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="size-4 text-emerald-600" />
          Visual Pipeline Builder
        </CardTitle>
        <CardDescription>
          Build multi-stage pipelines visually — no YAML needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pipeline name */}
        <div className="space-y-1">
          <Label htmlFor="pipeline-name" className="text-xs">Pipeline name (optional)</Label>
          <Input
            id="pipeline-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Build + Test + Deploy"
            className="h-8 text-sm"
          />
        </div>

        {/* Stages */}
        {stages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <GitBranch className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No stages yet.</p>
            <Button size="sm" variant="outline" onClick={addStage} disabled={workflows.length === 0}>
              <Plus className="size-4" />
              Add first stage
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((stage, idx) => (
              <div key={stage.id} className="flex items-center gap-2">
                {/* Stage number + arrow */}
                <div className="flex w-8 shrink-0 flex-col items-center">
                  {idx > 0 && <ArrowRight className="size-3 rotate-90 text-muted-foreground/40" />}
                  <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-medium text-emerald-600">
                    {idx + 1}
                  </span>
                </div>

                {/* Workflow selector */}
                <select
                  value={stage.workflow}
                  onChange={(e) => updateStage(stage.id, e.target.value)}
                  className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                >
                  {workflows.map((w) => (
                    <option key={w.key} value={w.key}>{w.name}</option>
                  ))}
                </select>

                {/* Dependencies (show for stages after first) */}
                {idx > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">after:</span>
                    {stages.slice(0, idx).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleDependency(stage.id, s.id)}
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                          stage.dependsOn.includes(s.id)
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                            : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {stages.indexOf(s) + 1}
                      </button>
                    ))}
                  </div>
                )}

                {/* Remove */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 text-red-600 hover:bg-red-500/10"
                  onClick={() => removeStage(stage.id)}
                  aria-label="Remove stage"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}

            {/* Add + Run buttons */}
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={addStage}>
                <Plus className="size-4" />
                Add stage
              </Button>
              <Button
                size="sm"
                onClick={runPipeline}
                disabled={stages.length === 0 || startRun.isPending}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Play className="size-4" />
                Run pipeline ({stages.length} stage{stages.length === 1 ? "" : "s"})
              </Button>
            </div>
          </div>
        )}

        {/* Pipeline preview */}
        {stages.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Pipeline preview
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              {stages.map((s, i) => (
                <span key={s.id} className="flex items-center gap-1">
                  {i > 0 && <ArrowRight className="size-3 text-muted-foreground/60" />}
                  <code className="rounded bg-background px-1.5 py-0.5 font-mono">{s.workflow}</code>
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
