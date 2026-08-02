"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  /** Called when the user clicks "Try again" (in addition to resetting internal state). */
  onReset?: () => void;
  /** Optional label identifying which section crashed (shown as "Error in: {label}"). */
  label?: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

/** Maximum number of characters of the error message we render to the DOM. */
const MAX_ERROR_CHARS = 300;

function truncateMessage(message: string, max = MAX_ERROR_CHARS): string {
  if (message.length <= max) return message;
  return `${message.slice(0, max)}…`;
}

/**
 * Top-level React error boundary. Catches render-time errors from its subtree
 * and shows a full-page recovery UI (red-tinted card with AlertTriangle) instead
 * of a blank white screen. "Try again" resets the internal error state and
 * calls the optional `onReset` callback; "Reload page" does a full reload.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to console for dev visibility. In production this is where you'd
    // forward to Sentry / similar. We intentionally avoid touching any global
    // reporter here so the boundary stays self-contained.
    console.error("[ErrorBoundary] caught render error:", error, info);
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    const { label } = this.props;

    if (!hasError) {
      return this.props.children;
    }

    const message = error?.message ?? error?.name ?? "Unknown error";

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex min-h-[60vh] w-full items-center justify-center px-4 py-10"
      >
        <section
          className={cn(
            "w-full max-w-lg rounded-xl border border-red-500/30",
            "bg-red-500/5 p-6 shadow-sm",
            "dark:border-red-500/20 dark:bg-red-500/10",
          )}
        >
          <header className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg",
                "bg-red-500/10 text-red-600 dark:text-red-400",
              )}
            >
              <AlertTriangle className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Something went wrong
              </h2>
              {label ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Error in:{" "}
                  <span className="font-mono text-foreground/80">{label}</span>
                </p>
              ) : null}
            </div>
          </header>

          <pre
            className={cn(
              "mt-4 max-h-40 overflow-auto rounded-md border border-red-500/20",
              "bg-background/60 p-3 font-mono text-xs leading-relaxed",
              "text-red-700 dark:text-red-300 whitespace-pre-wrap break-words",
            )}
          >
            {truncateMessage(message)}
          </pre>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={this.handleReset}
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Try again
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={this.handleReload}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Reload page
            </Button>
          </div>
        </section>
      </div>
    );
  }
}

export default ErrorBoundary;

/**
 * Compact inline error boundary for individual tabs / sections. Renders a small
 * inline card on error instead of replacing the whole page, so the surrounding
 * chrome (header, tabs, footer) stays interactive.
 */
type SectionErrorBoundaryProps = {
  children: React.ReactNode;
  label?: string;
};

type SectionErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(
    error: Error,
  ): SectionErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[SectionErrorBoundary] caught render error:", error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    const { label } = this.props;

    if (!hasError) {
      return this.props.children;
    }

    const message = error?.message ?? error?.name ?? "Unknown error";

    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          "w-full rounded-lg border border-red-500/30 bg-red-500/5 p-4",
          "dark:border-red-500/20 dark:bg-red-500/10",
        )}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            className="size-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              This section failed to render
              {label ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-mono text-muted-foreground">
                    {label}
                  </span>
                </>
              ) : null}
            </p>
            <p
              className={cn(
                "mt-1 line-clamp-2 font-mono text-xs text-red-700 dark:text-red-300",
                "break-words",
              )}
            >
              {truncateMessage(message)}
            </p>
            <div className="mt-2.5 flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={this.handleReset}
              >
                <RotateCcw className="size-3" aria-hidden />
                Try again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
