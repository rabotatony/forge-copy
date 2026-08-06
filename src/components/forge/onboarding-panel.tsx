"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket, CheckCircle2, Circle, Loader2, Sparkles, Zap, Shield, Code, Package, Database, Cloud, AlertTriangle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ProjectProfile {
  framework: string | null; frameworkVersion: string | null; language: string;
  database: string | null; uiLibrary: string | null; cssFramework: string | null;
  testFramework: string | null; hasTests: boolean; linter: string | null;
  stateManagement: string | null; buildTool: string | null;
  hasDockerfile: boolean; hasCI: boolean; hasWebSocket: boolean; hasGraphQL: boolean;
  dependencyCount: number; sourceFileCount: number; warnings: string[]; strengths: string[];
}

interface OnboardingStep { id: string; title: string; description: string; done: boolean; action?: { label: string; workflow?: string } }

export function OnboardingPanel({ projectId, onRunWorkflow, onDismiss }: { projectId: string; onRunWorkflow: (workflow: string) => void; onDismiss: () => void }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ["forge", "profile", projectId],
    queryFn: async () => { const r = await fetch(`/api/forge/projects/${projectId}/profile`); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<ProjectProfile> },
  });

  if (isLoading || !profile) return <Card><CardContent className="flex items-center justify-center py-12"><Loader2 className="mr-2 size-5 animate-spin text-emerald-600" /><span className="text-sm text-muted-foreground">Profiling your project…</span></CardContent></Card>;

  const steps: OnboardingStep[] = [
    { id: "install", title: "Install dependencies", description: "Run npm install + auto-detect missing modules", done: false, action: { label: "Run", workflow: "install" } },
    { id: "build", title: "Build the project", description: profile.buildTool ? `Build with ${profile.buildTool}` : "Build — Forge auto-fixes common issues", done: false, action: { label: "Run", workflow: "build" } },
    { id: "test", title: "Run tests", description: profile.hasTests ? `Execute ${profile.testFramework ?? "test"} suite` : "No tests detected — consider adding a test framework", done: false, action: profile.hasTests ? { label: "Run", workflow: "test" } : undefined },
    { id: "security", title: "Security audit", description: `Check ${profile.dependencyCount} dependencies for vulnerabilities`, done: false, action: { label: "Run", workflow: "security-scan" } },
  ];
  if (profile.linter) steps.push({ id: "lint", title: `Run ${profile.linter}`, description: "Check code quality and style", done: false, action: { label: "Run", workflow: "lint" } });

  return (
    <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10"><Rocket className="size-4 text-emerald-600" /></div>
            <div><CardTitle className="text-base">Welcome to Forge</CardTitle><CardDescription>Here's what we found and what to do next</CardDescription></div>
          </div>
          <Button variant="ghost" size="icon" className="size-8" onClick={onDismiss} aria-label="Dismiss onboarding"><X className="size-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {profile.framework && <TechBadge icon={Rocket} label={profile.framework} version={profile.frameworkVersion} />}
          <TechBadge icon={Code} label={profile.language} />
          {profile.database && <TechBadge icon={Database} label={profile.database} />}
          {profile.uiLibrary && <TechBadge icon={Package} label={profile.uiLibrary} />}
          {profile.cssFramework && <TechBadge icon={Sparkles} label={profile.cssFramework} />}
          {profile.testFramework && <TechBadge icon={CheckCircle2} label={profile.testFramework} />}
          {profile.stateManagement && <TechBadge icon={Zap} label={profile.stateManagement} />}
          {profile.hasDockerfile && <TechBadge icon={Cloud} label="Docker" />}
          {profile.hasCI && <TechBadge icon={Shield} label="CI" />}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <StatBox value={profile.sourceFileCount} label="source files" />
          <StatBox value={profile.dependencyCount} label="dependencies" />
          <StatBox value={(profile.warnings ?? []).length} label="warnings" />
        </div>
        {((profile.strengths ?? []).length > 0 || (profile.warnings ?? []).length > 0) && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(profile.strengths ?? []).length > 0 && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"><h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3.5" />Strengths ({(profile.strengths ?? []).length})</h4><ul className="space-y-1">{(profile.strengths ?? []).slice(0, 5).map((s, i) => <li key={i} className="text-xs text-muted-foreground">{s}</li>)}</ul></div>}
            {(profile.warnings ?? []).length > 0 && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="size-3.5" />Needs attention ({(profile.warnings ?? []).length})</h4><ul className="space-y-1">{(profile.warnings ?? []).slice(0, 5).map((w, i) => <li key={i} className="text-xs text-muted-foreground">{w}</li>)}</ul></div>}
          </div>
        )}
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">Getting started checklist</h4>
          {steps.map(step => <OnboardingStepRow key={step.id} step={step} onAction={() => { if (step.action?.workflow) onRunWorkflow(step.action.workflow) }} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function OnboardingStepRow({ step, onAction }: { step: OnboardingStep; onAction: () => void }) {
  return <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card/50 px-3 py-2">{step.done ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}<div className="min-w-0 flex-1"><p className={cn("text-xs font-medium", step.done && "text-muted-foreground line-through")}>{step.title}</p><p className="text-[11px] text-muted-foreground">{step.description}</p></div>{step.action && !step.done && <Button size="sm" variant="outline" className="shrink-0 gap-1 text-xs" onClick={onAction}>{step.action.label}<ChevronRight className="size-3" /></Button>}</div>;
}

function TechBadge({ icon: Icon, label, version }: { icon: typeof Code; label: string; version?: string | null }) {
  return <Badge variant="secondary" className="gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Icon className="size-3" />{label}{version && <span className="text-[10px] opacity-70">v{version}</span>}</Badge>;
}

function StatBox({ value, label }: { value: number; label: string }) {
  return <div className="rounded-lg border border-border bg-card/50 px-2 py-1.5"><div className="text-lg font-bold tabular-nums">{value}</div><div className="text-[10px] text-muted-foreground">{label}</div></div>;
}

import { ChevronRight } from "lucide-react";
