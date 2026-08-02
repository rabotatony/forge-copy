"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Grade = "A" | "B" | "C" | "D" | "F";

interface HealthFactor {
  name: string;
  score: number;
  weight: number;
  contribution: number;
}

interface HealthResponse {
  score: number;
  grade: Grade;
  factors: HealthFactor[];
  recommendation: string;
}

interface GradeStyle {
  text: string;
  bg: string;
  ring: string;
  bar: string;
  label: string;
}

// Color map by grade — emerald (A/B), amber (C), orange (D), red (F).
// Never indigo or blue.
const GRADE_STYLES: Record<Grade, GradeStyle> = {
  A: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/30 border-emerald-500/30",
    bar: "bg-emerald-500",
    label: "Excellent",
  },
  B: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/30 border-emerald-500/30",
    bar: "bg-emerald-500",
    label: "Good",
  },
  C: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/30 border-amber-500/30",
    bar: "bg-amber-500",
    label: "Fair",
  },
  D: {
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    ring: "ring-orange-500/30 border-orange-500/30",
    bar: "bg-orange-500",
    label: "Poor",
  },
  F: {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    ring: "ring-red-500/30 border-red-500/30",
    bar: "bg-red-500",
    label: "Critical",
  },
};

/**
 * HealthScore — composite 0-100 project health score with a
 * per-factor breakdown and a recommendation banner.
 *
 * Accent colors: emerald (healthy) → amber → orange → red (unhealthy).
 * No indigo or blue is used anywhere.
 */
export function HealthScore({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "projects", projectId, "health"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/health`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Health check failed (${r.status})`);
      }
      return (await r.json()) as HealthResponse;
    },
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Computing health score…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader className="gap-1 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-red-500" />
            Health Score
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Failed to compute health score."}
        </CardContent>
      </Card>
    );
  }

  const style = GRADE_STYLES[data.grade];

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className={cn("size-4", style.text)} />
          Health Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Big score + grade */}
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex size-20 items-center justify-center rounded-full ring-2",
              style.bg,
              style.ring,
            )}
          >
            <span className={cn("text-3xl font-bold tabular-nums", style.text)}>
              {data.score}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className={cn("text-2xl font-bold", style.text)}>
                {data.grade}
              </span>
              <span className="text-xs text-muted-foreground">
                {style.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Overall project health, 0–100.
            </p>
          </div>
        </div>

        {/* Factor breakdown */}
        <div className="space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Factor Breakdown
          </div>
          {data.factors.map((factor) => {
            // Per-factor bar color uses the same thresholds as grades.
            const barColor =
              factor.score >= 80
                ? "bg-emerald-500"
                : factor.score >= 70
                  ? "bg-amber-500"
                  : factor.score >= 60
                    ? "bg-orange-500"
                    : "bg-red-500";
            return (
              <div key={factor.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{factor.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {factor.score}/100 · weight {factor.weight}% · +{factor.contribution}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      barColor,
                    )}
                    style={{ width: `${factor.score}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Recommendation */}
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            style.bg,
            style.ring,
            style.text,
          )}
        >
          {data.recommendation}
        </div>
      </CardContent>
    </Card>
  );
}
