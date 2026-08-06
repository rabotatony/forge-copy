"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  Play,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useProjectIntent,
  useAutoRun,
  type IntentSignal,
} from "./use-forge-api";
import { renderWorkflowIcon } from "./icon-map";

/**
 * IntentPanel — shows what Forge thinks the user wants to produce,
 * with a one-click "Auto-run" button that triggers the best workflow.
 *
 * This is the "smart" surface: instead of showing a flat list of 32
 * workflows, Forge says "I think you want an APK — click here and
 * I'll build it for you."
 */
export function IntentPanel({
  projectId,
  onRunStarted,
}: {
  projectId: string;
  onRunStarted?: (runId: string) => void;
}) {
  const { data, isLoading, isError, error } = useProjectIntent(projectId);
  const autoRun = useAutoRun(projectId);
  const [showDetails, setShowDetails] = useState(false);

  const handleAutoRun = async () => {
    try {
      const result = await autoRun.mutateAsync();
      toast.success(
        `Auto-run started: ${result.intentLabel} (${result.workflow})`,
      );
      onRunStarted?.(result.runId);
    } catch (e) {
      toast.error(
        `Auto-run failed: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  if (isLoading) {
    return (
      <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
        <CardContent className="flex items-center gap-3 py-4">
          <Loader2 className="size-5 animate-spin text-emerald-600" aria-hidden />
          <span className="text-sm text-muted-foreground">
            Analyzing project to detect your intent…
          </span>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return null; // silently skip — intent is an enhancement, not a requirement
  }

  const confidence = data.signals[0]?.confidence ?? 0;
  const confidencePct = Math.round(confidence * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent">
        <CardHeader className="gap-2 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Sparkles className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="text-xl">{data.intentEmoji}</span>
                  <span>{data.intentLabel}</span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "shrink-0 font-mono text-[10px]",
                      confidencePct >= 70
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : confidencePct >= 40
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {confidencePct}% confidence
                  </Badge>
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {data.summary}
                </CardDescription>
              </div>
            </div>

            {data.primaryAvailable && (
              <Button
                onClick={handleAutoRun}
                disabled={autoRun.isPending}
                className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
                size="sm"
              >
                {autoRun.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Zap className="size-4" />
                    Auto-run
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          {/* Recommended workflows strip */}
          {(data.recommended ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Recommended:
              </span>
              {(data.recommended ?? []).slice(0, 5).map((key) => {
                const reason = data.reasons[key];
                const isPrimary = key === data.primary;
                return (
                  <Badge
                    key={key}
                    variant={isPrimary ? "default" : "outline"}
                    className={cn(
                      "gap-1 font-mono text-[11px]",
                      isPrimary &&
                        "bg-emerald-600 text-white hover:bg-emerald-700",
                    )}
                    title={reason}
                  >
                    {renderWorkflowIcon(key, "size-3")}
                    {key}
                    {isPrimary && <CheckCircle2 className="size-3" />}
                  </Badge>
                );
              })}
            </div>
          )}

          {/* Collapsible details: all signals + evidence */}
          <Collapsible open={showDetails} onOpenChange={setShowDetails}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showDetails ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {showDetails ? "Hide" : "Show"} detection details
                <span className="ml-1 text-[10px] opacity-60">
                  ({(data.signals ?? []).length} signals)
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-background/50 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lightbulb className="size-3.5" aria-hidden />
                  How Forge reached this conclusion
                </div>
                {(data.signals ?? []).map((sig, idx) => (
                  <SignalRow key={`${sig.intent}-${idx}`} signal={sig} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SignalRow({ signal }: { signal: IntentSignal }) {
  const pct = Math.round(signal.confidence * 100);
  return (
    <div className="flex items-start gap-2 text-xs">
      <div className="mt-0.5 flex w-12 shrink-0 items-center gap-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              pct >= 70
                ? "bg-emerald-500"
                : pct >= 40
                  ? "bg-amber-500"
                  : "bg-muted-foreground/40",
            )}
            style={{ width: `${Math.max(pct, 5)}%` }}
          />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-medium text-foreground">
            {signal.intent}
          </span>
          <span className="text-muted-foreground">{signal.reason}</span>
        </div>
        {(signal.evidence ?? []).length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {(signal.evidence ?? []).map((ev, i) => (
              <li
                key={i}
                className="flex items-start gap-1 text-[11px] text-muted-foreground"
              >
                <span className="mt-0.5 text-emerald-500">·</span>
                <span className="font-mono">{ev}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
