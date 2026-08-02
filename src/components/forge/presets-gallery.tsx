"use client";

import { useMemo } from "react";
// Note: framer-motion removed to reduce memory pressure.
// Cards render statically (no layout animation).
import { Loader2, Play, Lock, Clock, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProjectWorkflows, useRunPreset } from "./use-forge-api";
import { WORKFLOW_PRESETS, availablePresets, type WorkflowPreset } from "@/lib/forge/presets";

/**
 * PresetsGallery — curated one-click workflow sequences.
 * Like GitHub Actions "starter workflows" but smarter: each preset
 * is a tuned sequence for a specific goal (ship APK, full CI, etc.).
 */
export function PresetsGallery({
  projectId,
  onPipelineStarted,
}: {
  projectId: string;
  onPipelineStarted?: (pipelineId: string) => void;
}) {
  const { data, isLoading } = useProjectWorkflows(projectId);
  const runPreset = useRunPreset(projectId);

  const available = useMemo(() => {
    const keys = data?.workflows.map((w) => w.key) ?? [];
    return availablePresets(keys);
  }, [data]);

  const handleRun = async (preset: WorkflowPreset) => {
    try {
      const result = await runPreset.mutateAsync(preset.id);
      toast.success(`Started "${preset.name}" preset (${result.steps.length} steps)`);
      onPipelineStarted?.(result.pipelineId);
    } catch (e) {
      toast.error(
        `Failed to start preset: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading presets…
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <Zap className="size-6 opacity-40" />
        <span>No presets available for this project yet.</span>
        <span className="text-xs">Upload a project with more structure to unlock presets.</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {available.map((preset, idx) => (
        <div key={preset.id}>
          <Card className="group relative h-full overflow-hidden transition-all hover:border-emerald-500/30 hover:shadow-md">
            <CardContent className="flex h-full flex-col gap-3 p-4">
              {/* Header: emoji + name + approval badge */}
              <div className="flex items-start gap-2.5">
                <span className="text-2xl" aria-hidden>
                  {preset.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">
                    {preset.name}
                  </h3>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="px-1.5 text-[10px] uppercase tracking-wide"
                    >
                      {preset.category}
                    </Badge>
                    {preset.requiresApproval && (
                      <Badge
                        variant="outline"
                        className="gap-0.5 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                      >
                        <Lock className="size-2.5" />
                        Approval
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {preset.description}
              </p>

              {/* Steps */}
              <div className="flex flex-wrap gap-1">
                {preset.steps.map((step, i) => (
                  <span key={step} className="flex items-center gap-0.5">
                    {i > 0 && <span className="text-muted-foreground/40">→</span>}
                    <code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
                      {step}
                    </code>
                  </span>
                ))}
              </div>

              {/* Footer: time estimate + run button */}
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="size-3" />
                  ~{preset.estimatedSeconds}s
                </span>
                <Button
                  size="sm"
                  onClick={() => void handleRun(preset)}
                  disabled={runPreset.isPending}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {runPreset.isPending && runPreset.variables === preset.id ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5" />
                      Run
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
