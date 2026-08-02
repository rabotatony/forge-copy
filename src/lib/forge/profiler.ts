// ============================================================
// Forge — Deep Project Profiler
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import type { Detection } from "./detector";

export interface ProjectProfile {
  name: string; version: string | null; description: string | null;
  framework: string | null; frameworkVersion: string | null; language: string;
  database: string | null; hasMigrations: boolean;
  uiLibrary: string | null; cssFramework: string | null;
  testFramework: string | null; hasTests: boolean; testCount: number;
  linter: string | null; formatter: string | null;
  hasTypeScript: boolean; typeChecker: string | null;
  stateManagement: string | null;
  deploymentTarget: string | null; hasDockerfile: boolean; hasCI: boolean; ciProvider: string | null;
  buildTool: string | null; packageManager: string;
  hasWebSocket: boolean; hasGraphQL: boolean; hasRestAPI: boolean; hasSSR: boolean;
  dependencyCount: number; devDependencyCount: number;
  sourceFileCount: number; totalLines: number;
  warnings: string[]; strengths: string[];
}

export function profileProject(rootDir: string, detection: Detection): ProjectProfile {
  const p: ProjectProfile = {
    name: "", version: null, description: null, framework: null, frameworkVersion: null,
    language: "Unknown", database: null, hasMigrations: false, uiLibrary: null,
    cssFramework: null, testFramework: null, hasTests: false, testCount: 0,
    linter: null, formatter: null, hasTypeScript: false, typeChecker: null,
    stateManagement: null, deploymentTarget: null, hasDockerfile: false, hasCI: false,
    ciProvider: null, buildTool: null, packageManager: "npm",
    hasWebSocket: false, hasGraphQL: false, hasRestAPI: false, hasSSR: false,
    dependencyCount: 0, devDependencyCount: 0, sourceFileCount: 0, totalLines: 0,
    warnings: [], strengths: [],
  };
  if (detection.type === "node") {
    let pkg: Record<string, unknown> = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8")); } catch { return p; }
    p.name = (detection as { packageName?: string }).packageName ?? "";
    p.language = fs.existsSync(path.join(rootDir, "tsconfig.json")) ? "TypeScript" : "JavaScript";
    p.hasTypeScript = p.language === "TypeScript";
    const deps: Record<string, string> = { ...(pkg.dependencies as Record<string, string> ?? {}), ...(pkg.devDependencies as Record<string, string> ?? {}) };
    p.dependencyCount = Object.keys(pkg.dependencies as object ?? {}).length;
    p.devDependencyCount = Object.keys(pkg.devDependencies as object ?? {}).length;
    if (deps.next) { p.framework = "Next.js"; p.frameworkVersion = deps.next.replace(/[\^~]/, ""); p.buildTool = "Turbopack"; p.hasSSR = true; }
    else if (deps.react) { p.framework = "React"; if (deps.vite) p.buildTool = "Vite"; }
    else if (deps.express) { p.framework = "Express"; p.hasRestAPI = true; }
    if (deps.prisma || deps["@prisma/client"]) { p.database = "Prisma"; p.hasMigrations = fs.existsSync(path.join(rootDir, "prisma/migrations")); }
    if (fs.existsSync(path.join(rootDir, "components.json"))) p.uiLibrary = "shadcn/ui";
    if (deps.tailwindcss) p.cssFramework = "Tailwind CSS";
    if (deps.vitest) { p.testFramework = "Vitest"; p.hasTests = true; }
    else if (deps.jest) { p.testFramework = "Jest"; p.hasTests = true; }
    if (deps.eslint) p.linter = "ESLint";
    if (deps.zustand) p.stateManagement = "Zustand";
    else if (deps["@reduxjs/toolkit"]) p.stateManagement = "Redux";
    else if (deps["@tanstack/react-query"]) p.stateManagement = "TanStack Query";
    if (fs.existsSync(path.join(rootDir, "pnpm-lock.yaml"))) p.packageManager = "pnpm";
    else if (fs.existsSync(path.join(rootDir, "yarn.lock"))) p.packageManager = "yarn";
    p.hasDockerfile = fs.existsSync(path.join(rootDir, "Dockerfile"));
    p.hasCI = fs.existsSync(path.join(rootDir, ".github/workflows"));
    p.sourceFileCount = countFiles(rootDir, [".ts", ".tsx", ".js", ".jsx"]);
  }
  if (p.hasTests) p.strengths.push("Has tests");
  if (p.linter) p.strengths.push(`Uses ${p.linter}`);
  if (p.hasTypeScript) p.strengths.push("Type-safe");
  if (p.hasCI) p.strengths.push("CI configured");
  if (p.database) p.strengths.push(`Database: ${p.database}`);
  if (p.framework) p.strengths.push(p.framework);
  if (!p.hasTests) p.warnings.push("No tests");
  if (!p.linter) p.warnings.push("No linter");
  if (!p.hasCI) p.warnings.push("No CI/CD");
  return p;
}

function countFiles(rootDir: string, exts: string[]): number {
  let count = 0;
  const visit = (dir: string) => {
    try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (exts.some(x => e.name.endsWith(x))) count++;
    } } catch {}
  };
  visit(rootDir);
  return count;
}
