"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types — mirror the API contract returned by
// /api/forge/projects/[id]/insights.
// ---------------------------------------------------------------------------
interface InsightsResponse {
  report: string;
  generatedAt: string;
}

/**
 * AIInsights — a card that fetches an AI-generated natural language
 * report for a project.
 *
 * Behavior:
 *   • Does NOT auto-fetch on mount. The user clicks "Generate Insights"
 *     to trigger the (expensive) LLM call.
 *   • Once data is loaded, react-query caches it for 5 minutes
 *     (staleTime) so background refetches don't fire.
 *   • The button morphs into a "Refresh" control after the first load
 *     and forces a refetch via `refetch()`.
 *   • While loading, shows "AI is analyzing your project…".
 *   • On error, shows the message inline.
 *   • The report text is split on newlines and rendered as paragraphs.
 *
 * Accent color: emerald only (never indigo or blue).
 */
export function AIInsights({ projectId }: { projectId: string }) {
  // Whether the user has opted in to the first LLM call. Stays true
  // after the first click so subsequent renders keep the query enabled.
  const [armed, setArmed] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["forge", "projects", projectId, "insights"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/insights`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Failed to generate insights (${r.status})`,
        );
      }
      return (await r.json()) as InsightsResponse;
    },
    // Don't auto-fetch — wait for the user to click.
    enabled: armed,
    // Cache for 5 minutes so background refetches don't spam the LLM.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const handleGenerate = (): void => {
    if (!armed) setArmed(true);
    void refetch();
  };

  const paragraphs = data?.report
    ? data.report
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  return (
    <Card>
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles
              className="size-4 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            AI Insights
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleGenerate}
            disabled={isLoading}
            className="h-7 gap-1.5 border-emerald-500/40 px-2.5 text-xs text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
          >
            {isLoading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : data ? (
              <RefreshCw className="size-3.5" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            {data ? "Refresh" : "Generate Insights"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2.5 py-6 text-sm text-muted-foreground">
            <Loader2
              className="size-4 animate-spin text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            AI is analyzing your project…
          </div>
        ) : isError ? (
          <p className="py-4 text-sm text-red-600 dark:text-red-400">
            {error instanceof Error
              ? error.message
              : "Failed to generate insights."}
          </p>
        ) : !data ? (
          <div className="space-y-2 py-4">
            <p className="text-sm text-muted-foreground">
              Generate an AI-powered analysis of this project&apos;s CI/CD
              health, including observations and recommendations.
            </p>
            <p className="text-xs text-muted-foreground">
              Click <span className="font-medium">Generate Insights</span> to
              start.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {paragraphs.length > 0 ? (
              paragraphs.map((p, i) => (
                <p
                  key={i}
                  className={cn(
                    "text-sm leading-relaxed text-foreground/90",
                    i === 0 && "font-medium text-foreground",
                  )}
                >
                  {p}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                {data.report}
              </p>
            )}
            <p className="pt-1 text-[11px] text-muted-foreground">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
