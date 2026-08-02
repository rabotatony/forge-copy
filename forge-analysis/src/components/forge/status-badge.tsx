"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ForgeKind, RunStatus } from "./use-forge-api";

/**
 * Colored status pill for a Forge run status.
 *
 * - success  → emerald
 * - failed   → red
 * - running  → amber (+ pulse)
 * - queued   → zinc
 * - canceled → zinc
 */
const STATUS_STYLES: Record<RunStatus, string> = {
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  failed:
    "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  running:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 animate-pulse",
  queued:
    "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
  canceled:
    "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
  waiting_approval:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 animate-pulse",
};

export function StatusBadge({
  status,
  className,
}: {
  status: RunStatus | null | undefined;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge
        variant="outline"
        className={cn("text-xs", className)}
        aria-label="No runs"
      >
        No runs
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn("text-xs capitalize", STATUS_STYLES[status], className)}
      aria-label={`Status: ${status}`}
    >
      {status}
    </Badge>
  );
}

/**
 * Colored kind badge for a Forge project kind.
 *
 * - node   → emerald (node.js)
 * - python → amber
 * - rust   → orange
 * - go     → cyan
 * - unknown → zinc
 *
 * No indigo/blue per design rules.
 */
const KIND_STYLES: Record<ForgeKind, string> = {
  node:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  python:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  rust:
    "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  go: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30",
  unknown:
    "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
};

export function KindBadge({
  kind,
  className,
}: {
  kind: ForgeKind | null | undefined;
  className?: string;
}) {
  const k = kind ?? "unknown";
  return (
    <Badge
      variant="outline"
      className={cn("text-xs capitalize", KIND_STYLES[k], className)}
      aria-label={`Kind: ${k}`}
    >
      {k}
    </Badge>
  );
}
