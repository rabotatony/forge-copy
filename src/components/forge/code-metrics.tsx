"use client";

import { useQuery } from "@tanstack/react-query";
import { Code2, FileCode, TrendingUp, Package, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "./format";

interface Metrics {
  totalFiles: number;
  totalLines: number;
  totalSize: number;
  languages: Array<{ lang: string; lines: number; pct: number }>;
  extensions: Array<{ ext: string; count: number }>;
  largestFiles: Array<{ file: string; lines: number; size: number }>;
  dependencies: { count: number; manager: string | null; list: string[] };
}

/**
 * CodeMetrics — shows project code statistics.
 * Lines of code, languages breakdown, file types, dependencies.
 */
export function CodeMetrics({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["forge", "projects", projectId, "metrics"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/metrics`);
      if (!r.ok) throw new Error("metrics unavailable");
      return (await r.json()) as Metrics;
    },
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Analyzing code…
        </CardContent>
      </Card>
    );
  }

  // Gracefully handle 404 / error (e.g. synthetic projects with no files).
  if (isError || !data || data.totalFiles === undefined) return null;

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Code2 className="size-4 text-muted-foreground" />
          Code Metrics
        </CardTitle>
        <CardDescription>
          Code statistics for this project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={FileCode} label="Files" value={data.totalFiles.toLocaleString()} />
          <Stat icon={TrendingUp} label="Lines" value={data.totalLines.toLocaleString()} />
          <Stat icon={Code2} label="Size" value={formatBytes(data.totalSize)} />
          <Stat icon={Package} label="Deps" value={data.dependencies.count.toString()} sub={data.dependencies.manager ?? undefined} />
        </div>

        {/* Language breakdown */}
        {data.languages.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Languages
            </div>
            <div className="space-y-1.5">
              {data.languages.slice(0, 6).map((l) => (
                <div key={l.lang} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate text-xs">{l.lang}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${l.pct}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[10px] font-mono tabular-nums text-muted-foreground">
                    {l.lines.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Largest files */}
        {data.largestFiles.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Largest files
            </div>
            <ul className="space-y-0.5">
              {data.largestFiles.slice(0, 5).map((f) => (
                <li key={f.file} className="flex items-center justify-between gap-2 text-xs">
                  <code className="min-w-0 truncate font-mono text-muted-foreground">{f.file}</code>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    {f.lines.toLocaleString()} lines
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Dependencies */}
        {data.dependencies.count > 0 && data.dependencies.list.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Dependencies ({data.dependencies.count})
            </div>
            <div className="flex flex-wrap gap-1">
              {data.dependencies.list.map((dep) => (
                <code
                  key={dep}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
                >
                  {dep}
                </code>
              ))}
              {data.dependencies.count > data.dependencies.list.length && (
                <span className="text-[10px] text-muted-foreground">
                  +{data.dependencies.count - data.dependencies.list.length} more
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof FileCode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border p-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-bold tabular-nums leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
