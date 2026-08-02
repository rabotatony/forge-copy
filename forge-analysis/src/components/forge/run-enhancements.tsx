"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, CheckCircle, XCircle, FlaskConical, Clock } from "lucide-react";
import { toast } from "sonner";
import { useApproval, useDecideApproval, useTestReport, useLogSearch } from "@/components/forge/use-forge-api-v2";

export function ApprovalBanner({ runId }: { runId: string }) {
  const { data } = useApproval(runId);
  const decide = useDecideApproval(runId);
  const [decidedBy, setDecidedBy] = useState("admin");
  const [reason, setReason] = useState("");

  if (!data?.required || data.status !== "pending") return null;

  const handleDecide = async (action: "approve" | "reject") => {
    try {
      await decide.mutateAsync({ action, decidedBy, reason: reason || undefined });
      toast.success(action === "approve" ? "Run approved" : "Run rejected");
      setReason("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-amber-600" />
            <div>
              <p className="font-medium">Manual approval required</p>
              <p className="text-xs text-muted-foreground">Requested {new Date(data.requestedAt ?? "").toLocaleString()}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={decidedBy} onChange={(e) => setDecidedBy(e.target.value)} placeholder="Your name" className="w-32 font-mono text-sm" />
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-40 text-sm" />
            <Button variant="outline" size="sm" onClick={() => handleDecide("reject")} disabled={decide.isPending}>
              <XCircle className="mr-1 size-4 text-red-600" />Reject
            </Button>
            <Button size="sm" onClick={() => handleDecide("approve")} disabled={decide.isPending}>
              <CheckCircle className="mr-1 size-4" />Approve
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TestReportPanel({ runId }: { runId: string }) {
  const { data } = useTestReport(runId);
  if (!data?.found || !data.report) return null;
  const report = data.report as {
    format: string; total: number; passed: number; failed: number; skipped: number; duration?: number | null;
    suites: Array<{ name: string; cases: Array<{ name: string; status: string; duration?: number; message?: string }> }>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-5" />
          Test Report
          <Badge variant="outline">{report.format}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-md border p-2 text-center">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-xl font-bold">{report.total}</div>
          </div>
          <div className="rounded-md border p-2 text-center bg-emerald-500/5">
            <div className="text-xs text-emerald-600">Passed</div>
            <div className="text-xl font-bold text-emerald-600">{report.passed}</div>
          </div>
          <div className="rounded-md border p-2 text-center bg-red-500/5">
            <div className="text-xs text-red-600">Failed</div>
            <div className="text-xl font-bold text-red-600">{report.failed}</div>
          </div>
          <div className="rounded-md border p-2 text-center">
            <div className="text-xs text-muted-foreground">Skipped</div>
            <div className="text-xl font-bold">{report.skipped}</div>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-2 [&::-webkit-scrollbar]:w-2">
          {report.suites.map((suite, i) => (
            <details key={i} className="rounded-md border">
              <summary className="cursor-pointer p-2 font-medium text-sm">
                {suite.name} <span className="text-muted-foreground">({suite.cases.length})</span>
              </summary>
              <div className="border-t divide-y">
                {suite.cases.map((tc, j) => (
                  <div key={j} className="flex items-start gap-2 p-2 text-xs">
                    {tc.status === "passed" ? <CheckCircle className="size-3.5 text-emerald-600 mt-0.5" /> :
                     tc.status === "failed" ? <XCircle className="size-3.5 text-red-600 mt-0.5" /> :
                     <div className="size-3.5 rounded-full border border-muted-foreground mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-mono">{tc.name}</p>
                      {tc.message && <p className="text-red-600 mt-0.5">{tc.message}</p>}
                    </div>
                    {tc.duration !== undefined && <span className="text-muted-foreground">{(tc.duration / 1000).toFixed(2)}s</span>}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function LogSearchBar({ runId }: { runId: string }) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const { data, isFetching } = useLogSearch(runId, activeQuery, { useRegex, caseSensitive });

  const handleSearch = () => {
    if (query.trim()) setActiveQuery(query.trim());
  };

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search logs…"
              className="pl-8 font-mono text-sm"
            />
          </div>
          <Button onClick={handleSearch} disabled={!query.trim() || isFetching} size="sm">
            <Search className="mr-1 size-4" />Search
          </Button>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} className="rounded" />
            Case sensitive
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} className="rounded" />
            Regex
          </label>
          {data && <span className="text-muted-foreground">{data.count} matches</span>}
        </div>
        {data && data.hits.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-0.5 bg-zinc-950 rounded p-2 [&::-webkit-scrollbar]:w-2">
            {data.hits.map((hit, i) => (
              <div key={i} className="font-mono text-xs text-zinc-300 flex gap-2">
                <span className="text-zinc-500 shrink-0">{hit.seq}</span>
                <span className={hit.stream === "stderr" ? "text-red-400" : hit.stream === "system" ? "text-zinc-500" : "text-zinc-200"}>{hit.text}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
