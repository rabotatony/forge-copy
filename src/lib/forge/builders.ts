// ============================================================
// Forge — Sovereign build system
// ============================================================
// Builds projects entirely on Forge's own infrastructure (the
// local node or any mesh node) — no external CI involved.
//
//   detectToolchain()     — package manager / framework / scripts
//   guardConfigSanity()   — quarantines root config files that
//                           import packages that are not installed
//                           (the exact failure class that broke
//                           Shoshana's site build: capacitor.config.ts
//                           importing @capacitor/cli in site mode)
//   runSovereignBuild()   — install + build with live logs via the
//                           hardened child-runner
//   collectStaticOutput() — locates out/ dist/ build/
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { runChildStep } from "./child-runner";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export interface Toolchain {
  packageManager: PackageManager;
  framework:
    | "next"
    | "vite"
    | "astro"
    | "svelte"
    | "react-scripts"
    | "node"
    | "static"
    | "unknown";
  scripts: Record<string, string>;
  hasLockfile: boolean;
  hasNodeModules: boolean;
}

export function detectToolchain(root: string): Toolchain {
  const has = (f: string) => fs.existsSync(path.join(root, f));
  let packageManager: PackageManager = "npm";
  if (has("bun.lockb") || has("bun.lock")) packageManager = "bun";
  else if (has("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (has("yarn.lock")) packageManager = "yarn";

  let framework: Toolchain["framework"] = "unknown";
  let scripts: Record<string, string> = {};
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      scripts = pkg.scripts ?? {};
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (deps.next) framework = "next";
      else if (deps.vite) framework = "vite";
      else if (deps.astro) framework = "astro";
      else if (deps["@sveltejs/kit"] || deps.svelte) framework = "svelte";
      else if (deps["react-scripts"]) framework = "react-scripts";
      else framework = "node";
    } catch {
      /* unreadable package.json -> unknown */
    }
  } else if (has("index.html")) {
    framework = "static";
  }
  return {
    packageManager,
    framework,
    scripts,
    hasLockfile:
      has("package-lock.json") || has("bun.lockb") || has("bun.lock") ||
      has("pnpm-lock.yaml") || has("yarn.lock"),
    hasNodeModules: has("node_modules"),
  };
}

// ------------------------------------------------------------
// Config sanity guard (self-healing)
// ------------------------------------------------------------
export interface GuardReport {
  moved: Array<{ file: string; missing: string[] }>;
}

const CONFIG_RE = /\.config\.(ts|mts|cts|js|mjs|cjs)$/;

function bareSpecifier(spec: string): string {
  if (spec.startsWith(".") || spec.startsWith("/")) return "";
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Scans root-level *.config.* files for imports of packages that
 * are neither declared in package.json nor present in node_modules.
 * Offending files are moved to .forge-quarantine/ (restorable) so
 * builds are not blocked by mode-specific config files.
 */
export function guardConfigSanity(
  root: string,
  log?: (m: string) => void,
): GuardReport {
  const report: GuardReport = { moved: [] };
  const pkgDeps = new Set<string>();
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const d of Object.keys({
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      })) pkgDeps.add(d);
    } catch {
      /* ignore */
    }
  }
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return report;
  }
  const quarantine = path.join(root, ".forge-quarantine");
  for (const entry of entries) {
    if (!CONFIG_RE.test(entry)) continue;
    const full = path.join(root, entry);
    let content = "";
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const specs = new Set<string>();
    for (const m of content.matchAll(
      /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g,
    )) {
      const b = bareSpecifier(m[1]);
      if (b) specs.add(b);
    }
    const missing = [...specs].filter(
      (s) =>
        !pkgDeps.has(s) &&
        !fs.existsSync(path.join(root, "node_modules", ...s.split("/"))),
    );
    if (missing.length === 0) continue;
    fs.mkdirSync(quarantine, { recursive: true });
    fs.renameSync(full, path.join(quarantine, entry));
    report.moved.push({ file: entry, missing });
    log?.(
      `[forge:guard] quarantined ${entry} — imports missing package(s): ${missing.join(", ")}`,
    );
  }
  if (report.moved.length > 0) {
    fs.writeFileSync(
      path.join(quarantine, "RESTORE.md"),
      `# Forge quarantine\n\nFiles here import packages that are not installed in this mode. They were moved aside so the build can proceed. Install the missing packages and move the file back to restore.\n\n` +
        report.moved
          .map((m) => `- \`${m.file}\` — missing: ${m.missing.join(", ")}`)
          .join("\n") +
        "\n",
    );
  }
  return report;
}

// ------------------------------------------------------------
// Build
// ------------------------------------------------------------
export interface SovereignBuildOptions {
  install?: boolean; // default true
  buildCommand?: string; // override; default "<pm> run build"
  env?: Record<string, string>;
  timeoutMs?: number; // default 20 minutes per step
  log?: (stream: "stdout" | "stderr", line: string) => void;
}

export interface SovereignBuildResult {
  ok: boolean;
  exitCode: number;
  timedOut: boolean;
  installExit: number | null;
  buildExit: number | null;
  outputDir: string | null;
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  return env;
}

export async function runSovereignBuild(
  root: string,
  opts: SovereignBuildOptions = {},
): Promise<SovereignBuildResult> {
  const tc = detectToolchain(root);
  const log = opts.log ?? (() => {});
  const env = { ...processEnv(), ...(opts.env ?? {}) };
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;

  let installExit: number | null = null;
  if (opts.install !== false && tc.framework !== "static") {
    let cmd: string;
    if (tc.packageManager === "bun") cmd = "bun install";
    else if (tc.packageManager === "pnpm") cmd = "pnpm install";
    else if (tc.packageManager === "yarn") cmd = "yarn install";
    else cmd = tc.hasLockfile ? "npm ci" : "npm install";
    log("stdout", `[forge] installing dependencies: ${cmd}`);
    const r = await runChildStep({
      cwd: root,
      command: cmd,
      env,
      secrets: {},
      timeoutMs,
      onLine: log,
    });
    installExit = r.exitCode;
    if (r.exitCode !== 0) {
      return { ok: false, exitCode: r.exitCode, timedOut: r.timedOut, installExit, buildExit: null, outputDir: null };
    }
  }

  let buildExit: number | null = null;
  if (opts.buildCommand || tc.scripts.build) {
    const cmd = opts.buildCommand ?? `${tc.packageManager} run build`;
    log("stdout", `[forge] building: ${cmd}`);
    const r = await runChildStep({
      cwd: root,
      command: cmd,
      env,
      secrets: {},
      timeoutMs,
      onLine: log,
    });
    buildExit = r.exitCode;
    if (r.exitCode !== 0) {
      return { ok: false, exitCode: r.exitCode, timedOut: r.timedOut, installExit, buildExit, outputDir: null };
    }
  }

  return {
    ok: true,
    exitCode: 0,
    timedOut: false,
    installExit,
    buildExit,
    outputDir: collectStaticOutput(root),
  };
}

/** Locates the conventional static output directory, if present. */
export function collectStaticOutput(root: string): string | null {
  const hasPkg = fs.existsSync(path.join(root, "package.json"));
  const candidates = hasPkg ? ["out", "dist", "build"] : ["out", "dist", "build", "public", "."];
  for (const d of candidates) {
    const p = path.join(root, d);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        // skip empty dirs
        if (fs.readdirSync(p).length > 0) return p;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
