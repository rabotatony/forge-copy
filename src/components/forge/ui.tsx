"use client";

// ============================================================
// Forge — unified UI primitives
// ============================================================
// ONE coherent UI language for the Forge dashboard surface.
// Replaces the 5+ StatCard redefinitions, 5+ loading patterns,
// 5+ error-card patterns, 6+ empty-state divs, and 3 separate
// CategoryChip implementations that previously lived inline in
// global-dashboard / global-marketplace / global-settings /
// experiments-lab / project-list / marketplace-browser /
// workflow-catalog / presets-gallery.
//
// Design rules:
//   • Built on shadcn/ui primitives (Card, Button) + lucide icons
//   • Emerald is the brand accent — never indigo or blue
//   • Consistent padding (p-4 / p-6), gap (gap-4), rounded corners
//   • Dark-mode aware (bg-background / text-foreground / text-muted-foreground)
//   • TypeScript strict — every prop typed
// ============================================================

import type { ReactNode } from "react";
import { Loader2, AlertCircle, Inbox, Anvil } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Accent palette — emerald is the brand accent; the others are status tones.
// ---------------------------------------------------------------------------

export type StatAccent = "emerald" | "amber" | "rose" | "sky" | "violet";

const ACCENT_ICON: Record<StatAccent, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  sky: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

const ACCENT_VALUE: Record<StatAccent, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  rose: "text-rose-600 dark:text-rose-400",
  sky: "text-sky-600 dark:text-sky-400",
  violet: "text-violet-600 dark:text-violet-400",
};

// ---------------------------------------------------------------------------
// 1. Loading
// ---------------------------------------------------------------------------
// Replaces Skeleton / Loader2-spin / plain-text / animate-pulse / null.
// One look: centered spinner + label, sits inside whatever container the
// caller drops it in.
// ---------------------------------------------------------------------------

export function Loading({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-9 items-center justify-center">
        <span className="forge-ember absolute inset-0 rounded-lg" style={{ boxShadow: "0 0 22px 5px rgba(230,127,56,0.28)" }} />
        <span className="relative flex size-9 items-center justify-center rounded-lg border border-amber-400/25 bg-gradient-to-b from-[#2a1a10] to-[#171008]">
          <Anvil className="size-4 text-amber-400" aria-hidden />
        </span>
      </span>
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. ErrorState
// ---------------------------------------------------------------------------
// Replaces the various inline error cards (red text in a Card, red banner,
// alert icon + message, etc.). Optional retry button.
// ---------------------------------------------------------------------------

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <AlertCircle className="size-5" aria-hidden />
        </div>
        <p className="max-w-md text-sm text-rose-600 dark:text-rose-400">
          {message}
        </p>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-1.5"
          >
            <Loader2 className="size-3.5" aria-hidden />
            Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3. EmptyState
// ---------------------------------------------------------------------------
// Replaces the various inline empty-state divs (icon-in-circle + title +
// description). Optional action node for "Clear filters" / "Upload" CTA.
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. StatCard
// ---------------------------------------------------------------------------
// Replaces the 4+ StatCard redefinitions (global-dashboard / global-settings
// / experiments-lab / system-stats). Single accent palette (emerald default,
// amber for warning, rose for danger, sky/violet for category color-coding).
// ---------------------------------------------------------------------------

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = "emerald",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  accent?: StatAccent;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            ACCENT_ICON[accent],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div
            className={cn(
              "text-lg font-bold leading-tight tabular-nums",
              ACCENT_VALUE[accent],
            )}
          >
            {value}
          </div>
          {hint ? (
            <div className="truncate text-[10px] text-muted-foreground">
              {hint}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 5. SectionCard
// ---------------------------------------------------------------------------
// A titled Card with optional icon + description + trailing action. Use this
// instead of writing `<Card><CardHeader>...</CardHeader><CardContent>...`
// by hand every time — it enforces the emerald-icon + tracking-tight title
// + muted description pattern that was copy-pasted across the dashboard.
// ---------------------------------------------------------------------------

export function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  className,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {Icon ? (
            <Icon
              className="size-4 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
          ) : null}
          <span>{title}</span>
          {action ? (
            <span className="ml-auto">{action}</span>
          ) : null}
        </CardTitle>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 6. CategoryChip
// ---------------------------------------------------------------------------
// Replaces the 3 separate CategoryChip redefinitions
// (global-marketplace / marketplace-browser / workflow-catalog). Emerald
// when active, muted border otherwise, optional count badge.
//
// Callers that previously rendered an emoji + label + count chip should
// inline the emoji into the label string (e.g. label={`✨ ${cat.label}`}).
// ---------------------------------------------------------------------------

export function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
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
      <span>{label}</span>
      {count !== undefined ? (
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
      ) : null}
    </button>
  );
}


import { Component as _SafeComp, type ReactNode as _SafeNode } from "react";
interface _SafeState { error: Error | null }
export class Safe extends _SafeComp<{ children: _SafeNode; label?: string }, _SafeState> {
  state: _SafeState = { error: null };
  static getDerivedStateFromError(error: Error): _SafeState { return { error }; }
  componentDidCatch(error: Error) {
    // Report the crash to live UI telemetry so an orchestrator can "see" it.
    try {
      fetch("/api/forge/telemetry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "panel-crash", panel: this.props.label ?? "unknown", error: String(error?.message ?? error) }),
      }).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          {this.props.label ?? "This panel"} hit a snag: {String(this.state.error?.message ?? this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}
