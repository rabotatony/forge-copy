// ============================================================
// Forge — Project Insights Engine
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import type { Detection } from "./detector";
import { countFilesInDir } from "./fs-utils";

export type InsightCategory = "critical" | "security" | "quality" | "performance" | "readiness" | "opportunity";
export type InsightPriority = "critical" | "high" | "medium" | "low";

export interface Insight {
  id: string; category: InsightCategory; priority: InsightPriority;
  title: string; description: string; action: string;
  workflow?: string; effort: "quick" | "medium" | "large";
  value: "low" | "medium" | "high" | "critical";
  evidence?: string[]; done?: boolean;
}

export interface ProjectAnalysis {
  projectId: string; analyzedAt: string;
  metrics: {
    fileCount: number; totalBytes: number; dependencyCount: number;
    hasTests: boolean; hasLinting: boolean; hasCI: boolean; hasDockerfile: boolean;
    hasReadme: boolean; hasGitignore: boolean; hasLicense: boolean;
    buildScriptExists: boolean; testScriptExists: boolean;
    framework: string | null; language: string | null;
  };
  insights: Insight[];
  healthScore: number;
}

export function analyzeProjectWithProfile(
  projectId: string, rootDir: string, detection: Detection,
  runHistory: { workflow: string; status: string }[],
  profile: {
    framework: string | null; language: string; database: string | null;
    testFramework: string | null; hasTests: boolean; linter: string | null;
    hasDockerfile: boolean; hasCI: boolean; dependencyCount: number;
    sourceFileCount: number; warnings: string[]; strengths: string[];
  },
): ProjectAnalysis {
  const wasRun = (wf: string) => runHistory?.some(r => r.workflow === wf && r.status === "success") ?? false;
  const { fileCount, totalBytes } = countFilesInDir(rootDir);
  const insights: Insight[] = [];
  const m = {
    fileCount, totalBytes, dependencyCount: profile.dependencyCount,
    hasTests: profile.hasTests, hasLinting: !!profile.linter, hasCI: profile.hasCI,
    hasDockerfile: profile.hasDockerfile, hasReadme: fs.existsSync(path.join(rootDir, "README.md")),
    hasGitignore: fs.existsSync(path.join(rootDir, ".gitignore")), hasLicense: fs.existsSync(path.join(rootDir, "LICENSE")),
    buildScriptExists: detection.type === "node" && (detection as { scripts?: Record<string,string> }).scripts?.build !== undefined,
    testScriptExists: profile.hasTests, framework: profile.framework, language: profile.language,
  };

  if (detection.type === "node" && m.buildScriptExists && fs.existsSync(path.join(rootDir, ".next"))) {
    insights.push({ id: "stale-cache", category: "critical", priority: "critical", title: "Stale build cache detected", description: "A .next directory exists. Run Build to clean and rebuild.", action: "Run the Build workflow.", workflow: "build", effort: "quick", value: "critical", done: wasRun("build") });
  }
  if (m.dependencyCount > 0) {
    insights.push({ id: "security", category: "security", priority: "high", title: "Run a security audit", description: `Your ${profile.framework ?? "project"} has ${m.dependencyCount} dependencies.`, action: "Run the Security Scan workflow.", workflow: "security-scan", effort: "quick", value: "high", done: wasRun("security-scan") });
  }
  if (!m.hasTests && m.fileCount > 5) {
    insights.push({ id: "no-tests", category: "quality", priority: "high", title: "No test suite detected", description: `${m.fileCount} source files but no tests.`, action: "Set up a test framework.", workflow: "test", effort: "large", value: "high" });
  } else if (m.hasTests) {
    insights.push({ id: "run-tests", category: "quality", priority: "medium", title: `Run ${profile.testFramework ?? "tests"}`, description: "Tests exist but haven't been run.", action: "Run the Test workflow.", workflow: "test", effort: "quick", value: "medium", done: wasRun("test") });
  }
  if (profile.framework === "Next.js" && m.buildScriptExists) {
    insights.push({ id: "bundle", category: "performance", priority: "medium", title: "Analyze bundle size", description: "Next.js projects can accumulate large bundles.", action: "Run the Bundle Size workflow.", workflow: "bundle-size", effort: "quick", value: "medium", done: wasRun("bundle-size") });
  }
  if (!m.hasCI) {
    insights.push({ id: "ci", category: "readiness", priority: "high", title: "No CI/CD pipeline", description: "Forge IS your CI — set up triggers.", action: "Go to Configure → Triggers.", effort: "medium", value: "high" });
  }
  if (!m.hasDockerfile && profile.framework) {
    insights.push({ id: "docker", category: "readiness", priority: "low", title: "Containerize with Docker", description: `A Dockerfile makes your ${profile.framework} app deployable.`, action: "Create a Dockerfile.", workflow: "docker-build", effort: "medium", value: "medium", done: wasRun("docker-build") });
  }
  if (profile.framework === "Next.js" && fs.existsSync(path.join(rootDir, ".next"))) {
    insights.push({ id: "incremental", category: "opportunity", priority: "medium", title: "Use incremental build for faster rebuilds", description: "Skip npm install (saves 30-44s on large projects) and rebuild with cached dependencies.", action: "Run Build (Incremental).", workflow: "build-incremental", effort: "quick", value: "high", done: wasRun("build-incremental") });
  }
  if (profile.database === "Prisma" && !fs.existsSync(path.join(rootDir, "prisma/migrations"))) {
    insights.push({ id: "migrations", category: "readiness", priority: "medium", title: "Set up database migrations", description: "You're using Prisma without migrations.", action: "Run 'npx prisma migrate dev'.", effort: "medium", value: "medium" });
  }

  const order: Record<InsightPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  insights.sort((a, b) => { if (a.done && !b.done) return 1; if (!a.done && b.done) return -1; return order[a.priority] - order[b.priority]; });
  let score = 100;
  for (const i of insights) { score -= i.done ? 0 : i.priority === "critical" ? 20 : i.priority === "high" ? 10 : i.priority === "medium" ? 5 : 2; }
  if (m.hasTests) score += 5; if (m.hasLinting) score += 5; if (m.hasCI) score += 5;
  return { projectId, analyzedAt: new Date().toISOString(), metrics: m, insights, healthScore: Math.max(0, Math.min(100, score)) };
}
