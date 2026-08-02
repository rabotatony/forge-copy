"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { LogLine, LogStream, RunStatus } from "./use-forge-api";

const STREAM_COLORS: Record<LogStream, string> = {
  stdout: "text-zinc-100",
  stderr: "text-red-400",
  system: "text-zinc-500",
};

const STREAM_PREFIX: Record<LogStream, string> = {
  stdout: "",
  stderr: "",
  system: "▸ ",
};

/**
 * Dark monospace auto-scrolling terminal for displaying live run logs.
 *
 * - `logs` is the accumulated list (caller owns this state and appends
 *   events from `useRunStream`).
 * - `status` controls the "Live" indicator: pulsing while running/queued.
 *
 * Auto-scrolls to bottom when new logs arrive, unless the user has scrolled
 * up to inspect earlier output (then we leave them in place).
 */
export function LogTerminal({
  logs,
  status,
  className,
}: {
  logs: LogLine[];
  status: RunStatus | null | undefined;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Track whether the user is parked at the bottom.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottomRef.current = atBottom;
  };

  // Auto-scroll to bottom when new logs arrive.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const live = status === "running" || status === "queued";
  const empty = logs.length === 0;

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          <span className="font-mono">Logs</span>
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-amber-400" />
              </span>
              Live
            </span>
          )}
        </div>
        <span className="text-[10px] tabular-nums text-zinc-500">
          {logs.length} {logs.length === 1 ? "line" : "lines"}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn(
          "flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed",
          "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent",
        )}
      >
        {empty ? (
          <div className="flex h-full items-center justify-center py-8 text-zinc-600">
            {live ? "Waiting for output…" : "No log output."}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {logs.map((l) => (
              <div
                key={l.seq}
                className={cn(
                  "whitespace-pre-wrap break-words",
                  STREAM_COLORS[l.stream],
                )}
              >
                {STREAM_PREFIX[l.stream]}
                {l.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
