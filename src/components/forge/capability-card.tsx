"use client";

import { useQuery } from "@tanstack/react-query";
import { Rocket, Database, Code, Palette, FlaskConical, Shield, Container, GitBranch, Zap, Bot, Layers, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loading } from "./ui";

interface ProjectProfile {
  framework: string | null; frameworkVersion: string | null; language: string;
  database: string | null; uiLibrary: string | null; cssFramework: string | null;
  testFramework: string | null; hasTests: boolean; linter: string | null;
  stateManagement: string | null; buildTool: string | null;
  hasDockerfile: boolean; hasCI: boolean; hasWebSocket: boolean; hasGraphQL: boolean;
  dependencyCount: number; sourceFileCount: number; warnings: string[]; strengths: string[];
}

export function CapabilityCard({ projectId }: { projectId: string }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ["forge", "profile", projectId],
    queryFn: async () => { const r = await fetch(`/api/forge/projects/${projectId}/profile`); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<ProjectProfile> },
    staleTime: 30_000,
  });

  if (isLoading || !profile) return <Loading label="Loading capabilities…" />;

  const capabilities = [
    { icon: Rocket, label: "Framework", value: profile.framework ? `${profile.framework}${profile.frameworkVersion ? ` ${profile.frameworkVersion}` : ""}` : null },
    { icon: Code, label: "Language", value: profile.language },
    { icon: Database, label: "Database", value: profile.database },
    { icon: Palette, label: "UI Library", value: profile.uiLibrary },
    { icon: Layers, label: "CSS", value: profile.cssFramework },
    { icon: Zap, label: "State Mgmt", value: profile.stateManagement },
    { icon: FlaskConical, label: "Tests", value: profile.testFramework },
    { icon: Shield, label: "Linter", value: profile.linter },
    { icon: Container, label: "Docker", value: profile.hasDockerfile ? "Yes" : null },
    { icon: GitBranch, label: "CI/CD", value: profile.hasCI ? "Yes" : null },
  ].filter(c => c.value !== null);

  const forgeCapabilities = [
    { icon: Zap, label: "Smart workflows", desc: "Auto-fixing builds" },
    { icon: TrendingUp, label: "Incremental builds", desc: "Skip unchanged" },
    { icon: Bot, label: "Agent API", desc: "AI agent integration" },
    { icon: FlaskConical, label: "Experiments", desc: "LLM-driven discovery" },
  ];

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Layers className="size-4 text-emerald-600" />Project Capabilities</CardTitle>
        <CardDescription>{profile.sourceFileCount} source files · {profile.dependencyCount} dependencies · {profile.strengths.length} strengths</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {capabilities.map(cap => <div key={cap.label} className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2"><cap.icon className="size-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate text-xs font-medium">{cap.value}</div><div className="text-[10px] text-muted-foreground">{cap.label}</div></div></div>)}
        </div>
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Forge capabilities for this project</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {forgeCapabilities.map(cap => <div key={cap.label} className="flex flex-col gap-1 rounded-lg bg-emerald-500/5 px-3 py-2"><div className="flex items-center gap-1.5"><cap.icon className="size-3 text-emerald-600" /><span className="text-xs font-medium">{cap.label}</span></div><span className="text-[10px] text-muted-foreground">{cap.desc}</span></div>)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
