"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Severity = "low" | "moderate" | "high" | "critical" | "none";

interface Dependency {
  name: string;
  version: string;
  vulnerable: boolean;
  severity: Severity;
}

interface ScanResult {
  dependencies: Dependency[];
  summary: {
    total: number;
    vulnerable: number;
    bySeverity: Record<Severity, number>;
  };
}

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-300 ring-orange-500/30",
  moderate: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  low: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 ring-yellow-500/30",
  none: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  none: "Safe",
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "moderate", "low", "none"];

/**
 * DependencyScanner — scans the project's manifest and surfaces
 * any known-vulnerable packages. Color-coded badges only ever use
 * emerald (safe) or red/orange/amber/yellow (vulnerable) — never
 * indigo or blue.
 */
export function DependencyScanner({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "projects", projectId, "scan-deps"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/scan-deps`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Scan failed (${r.status})`);
      }
      return (await r.json()) as ScanResult;
    },
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Scanning dependencies…
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className="gap-1 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-red-500" />
            Dependency Scan
          </CardTitle>
          <CardDescription className="text-red-600 dark:text-red-400">
            {error instanceof Error ? error.message : "Scan failed"}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!data) return null;

  const { summary } = data;
  const clean = summary.vulnerable === 0;
  const sorted = [...data.dependencies].sort((a, b) => {
    const sa = SEVERITY_ORDER.indexOf(a.severity);
    const sb = SEVERITY_ORDER.indexOf(b.severity);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {clean ? (
            <ShieldCheck className="size-4 text-emerald-500" />
          ) : (
            <ShieldAlert className="size-4 text-red-500" />
          )}
          Dependency Scan
        </CardTitle>
        <CardDescription>
          {summary.total === 0
            ? "No dependencies found in this project."
            : clean
              ? `All ${summary.total} dependencies look clean.`
              : `${summary.vulnerable} of ${summary.total} dependencies flagged.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SummaryStat
            icon={Package}
            label="Total"
            value={summary.total}
            tone="neutral"
          />
          <SummaryStat
            icon={clean ? ShieldCheck : ShieldAlert}
            label="Vulnerable"
            value={summary.vulnerable}
            tone={clean ? "safe" : "danger"}
          />
          <SummaryStat
            icon={Shield}
            label="Clean"
            value={summary.total - summary.vulnerable}
            tone="safe"
          />
        </div>

        {/* Severity breakdown — only show levels with >0 count */}
        {summary.total > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {SEVERITY_ORDER.map((sev) => {
              const count = summary.bySeverity[sev] ?? 0;
              if (count === 0) return null;
              return (
                <span
                  key={sev}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                    SEVERITY_BADGE[sev],
                  )}
                >
                  <span className="font-mono tabular-nums">{count}</span>
                  {SEVERITY_LABEL[sev]}
                </span>
              );
            })}
          </div>
        )}

        {/* Dependency table */}
        {data.dependencies.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Package</th>
                  <th className="px-3 py-2 text-left">Version</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((dep) => (
                  <tr key={`${dep.name}@${dep.version}`} className="text-xs">
                    <td className="px-3 py-2">
                      <code className="font-mono">{dep.name}</code>
                    </td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-muted-foreground">
                        {dep.version || "—"}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                          SEVERITY_BADGE[dep.severity],
                        )}
                      >
                        {dep.vulnerable ? (
                          <AlertTriangle className="size-3" />
                        ) : (
                          <ShieldCheck className="size-3" />
                        )}
                        {SEVERITY_LABEL[dep.severity]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.total > 0 && clean && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-4 shrink-0" />
            No known vulnerabilities detected against the bundled advisory list.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Package;
  label: string;
  value: number;
  tone: "neutral" | "safe" | "danger";
}) {
  const iconColor =
    tone === "safe"
      ? "text-emerald-500"
      : tone === "danger"
        ? "text-red-500"
        : "text-muted-foreground";
  const valueColor =
    tone === "safe"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "danger"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";
  return (
    <div className="flex items-center gap-2 rounded-lg border p-2.5">
      <Icon className={cn("size-4 shrink-0", iconColor)} />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={cn("text-sm font-bold tabular-nums leading-tight", valueColor)}>
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}
