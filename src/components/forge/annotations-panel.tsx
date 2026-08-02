"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Annotation {
  id: string;
  level: string;
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  createdAt: string;
}

const ICONS = {
  error: AlertCircle,
  warning: AlertTriangle,
  notice: Info,
} as const;

const COLORS = {
  error: "text-red-600 dark:text-red-400 bg-red-500/5 border-red-500/20",
  warning: "text-amber-600 dark:text-amber-400 bg-amber-500/5 border-amber-500/20",
  notice: "text-blue-600 dark:text-blue-400 bg-blue-500/5 border-blue-500/20",
} as const;

/**
 * AnnotationsPanel — shows error/warning/notice annotations on a run.
 * Like GitHub Actions annotations, but Forge-native.
 */
export function AnnotationsPanel({ runId }: { runId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["forge", "runs", runId, "annotations"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/runs/${runId}/annotations`);
      return (await r.json()) as { annotations: Annotation[]; count: number };
    },
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading annotations…
        </CardContent>
      </Card>
    );
  }

  const annotations = data?.annotations ?? [];
  if (annotations.length === 0) return null;

  const errors = annotations.filter((a) => a.level === "error");
  const warnings = annotations.filter((a) => a.level === "warning");
  const notices = annotations.filter((a) => a.level === "notice");

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="size-4 text-muted-foreground" />
          Annotations
          <div className="flex items-center gap-1.5">
            {errors.length > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                <AlertCircle className="size-2.5" />
                {errors.length}
              </span>
            )}
            {warnings.length > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-2.5" />
                {warnings.length}
              </span>
            )}
            {notices.length > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                <Info className="size-2.5" />
                {notices.length}
              </span>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
          {annotations.map((a) => {
            const Icon = ICONS[a.level as keyof typeof ICONS] ?? Info;
            return (
              <li
                key={a.id}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2 text-xs",
                  COLORS[a.level as keyof typeof COLORS] ?? "",
                )}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="leading-relaxed">{a.message}</p>
                  {a.file && (
                    <code className="mt-0.5 block truncate text-[10px] opacity-70">
                      {a.file}
                      {a.line && `:${a.line}`}
                      {a.column && `:${a.column}`}
                    </code>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
