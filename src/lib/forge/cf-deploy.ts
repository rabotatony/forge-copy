// ============================================================
// Forge — Cloudflare deploy orchestrator (sovereign)
// ============================================================
// Deploys a Forge project to Cloudflare with NO external CI:
//   target 'pages'   — static site -> Cloudflare Pages (direct upload)
//   target 'workers' — full Next.js app -> @opennextjs/cloudflare build
//                       + wrangler deploy
// Same toolchain GitHub Actions used for Shoshana, run on the Forge
// node instead, so deploys are fully self-hosted.
// ============================================================
import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { getCfCredentials, type CfCredentials } from "@/lib/forge/cloudflare";
import { publishToCloudflarePages } from "@/lib/forge/cf-pages";

export type CfDeployTarget = "pages" | "workers";

export interface CfDeployResult {
  ok: boolean;
  target: CfDeployTarget;
  url?: string;
  log: string;
}

interface ShellResult { code: number; log: string; }

function runShell(cmd: string, args: string[], cwd: string, env: Record<string, string>, timeoutMs = 600_000): Promise<ShellResult> {
  return new Promise((resolve) => {
    let log = "";
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const append = (c: Buffer) => { log += c.toString(); if (log.length > 200_000) log = log.slice(-200_000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ code: -1, log: log + "\n[forge] killed after timeout" }); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, log }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: -1, log: log + "\n[forge] spawn error: " + err.message }); });
  });
}

function detectStaticOutDir(workspace: string): string | null {
  for (const c of ["out", "dist", "build", "public"]) {
    if (fs.existsSync(path.join(workspace, c))) return c;
  }
  return null;
}

// Deploy a static site to Cloudflare Pages via direct upload.
export async function deployStaticToPages(opts: {
  workspace: string;
  projectName: string;
  outDir?: string;      // relative to workspace; auto-detected if omitted
  creds?: CfCredentials | null;
}): Promise<CfDeployResult> {
  const creds = opts.creds ?? getCfCredentials();
  if (!creds) return { ok: false, target: "pages", log: "Cloudflare not configured" };
  const outRel = opts.outDir ?? detectStaticOutDir(opts.workspace);
  if (!outRel) return { ok: false, target: "pages", log: "No static output dir (out/dist/build/public)" };
  const abs = path.resolve(opts.workspace, outRel);
  try {
    const res = await publishToCloudflarePages({ projectName: opts.projectName, outDir: abs }, creds);
    if (!res.ok) return { ok: false, target: "pages", log: res.error ?? "Pages publish failed" };
    const url = res.url ?? res.projectUrl;
    return { ok: true, target: "pages", url, log: "Published to Pages: " + url };
  } catch (e) {
    return { ok: false, target: "pages", log: e instanceof Error ? e.message : String(e) };
  }
}

// Deploy a full Next.js app to Cloudflare Workers via OpenNext + wrangler.
export async function deployNextToWorkers(opts: {
  workspace: string;
  workerName?: string;
  creds?: CfCredentials | null;
}): Promise<CfDeployResult> {
  const creds = opts.creds ?? getCfCredentials();
  if (!creds) return { ok: false, target: "workers", log: "Cloudflare not configured" };
  const env = { CLOUDFLARE_API_TOKEN: creds.token, CLOUDFLARE_ACCOUNT_ID: creds.accountId };
  const ws = opts.workspace;
  let log = "";
  if (!fs.existsSync(path.join(ws, "node_modules"))) {
    const pm = fs.existsSync(path.join(ws, "bun.lockb")) || fs.existsSync(path.join(ws, "bun.lock")) ? "bun" : "npm";
    const inst = await runShell(pm, pm === "bun" ? ["install"] : ["install", "--no-audit"], ws, env);
    log += inst.log + "\n";
    if (inst.code !== 0) return { ok: false, target: "workers", log };
  }
  const build = await runShell("npx", ["--yes", "opennextjs-cloudflare", "build"], ws, env, 900_000);
  log += build.log + "\n";
  if (build.code !== 0) return { ok: false, target: "workers", log };
  const dep = await runShell("npx", ["--yes", "wrangler", "deploy"], ws, env, 600_000);
  log += dep.log;
  if (dep.code !== 0) return { ok: false, target: "workers", log };
  const m = log.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
  return { ok: true, target: "workers", url: m ? m[0] : undefined, log };
}

// High-level dispatcher.
export async function deployProjectToCloudflare(opts: {
  workspace: string;
  projectName: string;
  target: CfDeployTarget;
  workerName?: string;
  outDir?: string;
}): Promise<CfDeployResult> {
  if (opts.target === "pages") {
    return deployStaticToPages({ workspace: opts.workspace, projectName: opts.projectName, outDir: opts.outDir });
  }
  return deployNextToWorkers({ workspace: opts.workspace, workerName: opts.workerName });
}
