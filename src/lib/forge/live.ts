// ============================================================
// Forge — Live mode: edit -> auto-build -> instant preview
// ============================================================
// Makes Forge a live development environment: when live mode is
// enabled for a project, every file save triggers a debounced
// build, and the output is served instantly at:
//   /api/forge/projects/<id>/preview/
// No external CI required — the whole loop runs on the Forge node.
// State lives in <projectDir>/.forge-live.json (no schema change).
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { projectDir } from "@/lib/forge/storage";
import { audit } from "@/lib/forge/audit";

export interface LiveState {
  enabled: boolean;
  buildCommand: string | null;
  outputDir: string | null;
  lastBuildAt: string | null;
  lastBuildMs: number | null;
  lastBuildStatus: "success" | "failure" | "running" | null;
  lastBuildLog: string;
  buildCount: number;
}

const DEFAULT_STATE: LiveState = {
  enabled: false,
  buildCommand: null,
  outputDir: null,
  lastBuildAt: null,
  lastBuildMs: null,
  lastBuildStatus: null,
  lastBuildLog: "",
  buildCount: 0,
};

function statePath(projectId: string): string {
  return path.join(projectDir(projectId), ".forge-live.json");
}

export function getLiveState(projectId: string): LiveState {
  try {
    const raw = fs.readFileSync(statePath(projectId), "utf8");
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function setLiveState(projectId: string, patch: Partial<LiveState>): LiveState {
  const next = { ...getLiveState(projectId), ...patch };
  fs.mkdirSync(projectDir(projectId), { recursive: true });
  fs.writeFileSync(statePath(projectId), JSON.stringify(next, null, 2));
  return next;
}

export interface LivePlan {
  buildCommand: string | null;
  outputDir: string;
  reason: string;
}

export function detectLivePlan(workspace: string): LivePlan {
  let pkg: Record<string, unknown> | null = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8"));
  } catch { /* not a node project */ }

  const deps = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };
  const scripts = (pkg?.scripts as Record<string, string>) ?? {};
  const pm = fs.existsSync(path.join(workspace, "bun.lockb")) || fs.existsSync(path.join(workspace, "bun.lock"))
    ? "bun" : fs.existsSync(path.join(workspace, "pnpm-lock.yaml"))
    ? "pnpm" : fs.existsSync(path.join(workspace, "yarn.lock"))
    ? "yarn" : "npm";
  const run = pm === "yarn" ? "yarn" : `${pm} run`;

  if (deps.next && scripts.build) {
    return {
      buildCommand: `BUILD_STATIC=1 BUILD_APK=1 ${run} build`,
      outputDir: "out",
      reason: "Next.js detected — static export to out/ (BUILD_STATIC=1)",
    };
  }
  if ((deps.vite || deps.react || deps.vue) && scripts.build) {
    return {
      buildCommand: `${run} build`,
      outputDir: fs.existsSync(path.join(workspace, "dist")) ? "dist" : "build",
      reason: "Vite/SPA detected — build output served directly",
    };
  }
  if (scripts.build) {
    return {
      buildCommand: `${run} build`,
      outputDir: "dist",
      reason: "Generic npm build — assuming dist/ output (override via live config)",
    };
  }
  return {
    buildCommand: null,
    outputDir: ".",
    reason: "No build step detected — serving workspace files directly",
  };
}

export function resolvePreviewDir(project: { id: string; extractedPath: string }): { dir: string; state: LiveState } | null {
  const state = getLiveState(project.id);
  const workspace = project.extractedPath;
  if (!workspace || !fs.existsSync(workspace)) return null;
  let outputDir = state.outputDir;
  if (!outputDir) outputDir = detectLivePlan(workspace).outputDir;
  const dir = path.resolve(workspace, outputDir);
  const rootResolved = path.resolve(workspace);
  if (dir !== rootResolved && !dir.startsWith(rootResolved + path.sep)) return null;
  if (!fs.existsSync(dir)) return null;
  return { dir, state };
}

const building = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export async function runLiveBuild(projectId: string): Promise<LiveState> {
  if (building.has(projectId)) return getLiveState(projectId);
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return getLiveState(projectId);

  const workspace = project.extractedPath;
  if (!workspace || !fs.existsSync(workspace)) {
    return setLiveState(projectId, { lastBuildStatus: "failure", lastBuildLog: "Workspace missing" });
  }

  const state = getLiveState(projectId);
  const plan = detectLivePlan(workspace);
  const buildCommand = state.buildCommand ?? plan.buildCommand;

  if (!buildCommand) {
    return setLiveState(projectId, {
      lastBuildStatus: "success",
      lastBuildAt: new Date().toISOString(),
      lastBuildMs: 0,
      lastBuildLog: "Static project — no build step required.",
      buildCount: state.buildCount + 1,
      outputDir: state.outputDir ?? plan.outputDir,
    });
  }

  building.add(projectId);
  setLiveState(projectId, { lastBuildStatus: "running", lastBuildAt: new Date().toISOString() });
  const startedAt = Date.now();

  try {
    const result = await new Promise<{ code: number; log: string }>((resolve) => {
      const child = spawn("bash", ["-lc", buildCommand], {
        cwd: workspace,
        env: { ...process.env, NODE_ENV: "production", CI: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      const append = (chunk: Buffer) => {
        log += chunk.toString();
        if (log.length > 200_000) log = log.slice(-200_000);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ code: -1, log: log + "\n[forge] build killed after 600s timeout" });
      }, 600_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, log });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: -1, log: log + "\n[forge] spawn error: " + err.message });
      });
    });

    const elapsed = Date.now() - startedAt;
    const ok = result.code === 0;
    const next = setLiveState(projectId, {
      lastBuildStatus: ok ? "success" : "failure",
      lastBuildMs: elapsed,
      lastBuildLog: result.log.slice(-50_000),
      buildCount: getLiveState(projectId).buildCount + 1,
      outputDir: state.outputDir ?? plan.outputDir,
    });
    await audit("live.build", "project", projectId, "live", {
      status: ok ? "success" : "failure",
      ms: elapsed,
      command: buildCommand,
    });
    return next;
  } finally {
    building.delete(projectId);
  }
}

/** Debounced rebuild — call after every file save. */
export function scheduleLiveBuild(projectId: string, delayMs = 1500): void {
  const existing = timers.get(projectId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(projectId);
    runLiveBuild(projectId).catch(() => {});
  }, delayMs);
  timers.set(projectId, t);
}
