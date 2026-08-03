// ============================================================
// Forge — Universal deploy planner
// ============================================================
// Given a ProjectAnalysis, produce an ordered, executable plan:
// which targets this project can ship to and the concrete steps.
// ============================================================
import type { ProjectAnalysis } from "@/lib/forge/analyzer";

export type PlanTarget =
  | "live-preview"
  | "static-site"
  | "node-app"
  | "apk"
  | "gh-actions-build";

export interface PlanStep {
  label: string;
  kind: "command" | "blueprint" | "workflow" | "deploy" | "live" | "info";
  command?: string;
  blueprint?: string;
  workflow?: string;
  deploy?: string;
  detail?: string;
}

export interface UniversalPlan {
  targets: PlanTarget[];
  primaryTarget: PlanTarget | null;
  steps: PlanStep[];
  notes: string[];
}

function pmRun(pm: string): string {
  switch (pm) {
    case "bun": return "bun run";
    case "pnpm": return "pnpm run";
    case "yarn": return "yarn";
    default: return "npm run";
  }
}

function pmInstall(pm: string): string {
  switch (pm) {
    case "bun": return "bun install";
    case "pnpm": return "pnpm install";
    case "yarn": return "yarn install";
    default: return "npm install";
  }
}

export function planForAnalysis(a: ProjectAnalysis): UniversalPlan {
  const targets: PlanTarget[] = ["live-preview"];
  const steps: PlanStep[] = [];
  const notes: string[] = [];
  const run = pmRun(a.packageManager);
  const install = pmInstall(a.packageManager);

  const canStatic = a.framework !== "unknown" && a.capabilities.staticExport.ok;
  const needsSsr =
    a.capabilities.ssr.ok &&
    (a.apiRoutes.length > 0 || a.pages.some((p) => p.serverDataFetch));
  const canApk = a.capabilities.apkWrap.ok;

  steps.push({
    label: "Enable live mode — instant preview link on every save",
    kind: "live",
    detail: "Forge rebuilds in the background and serves output at the preview URL.",
  });

  if (a.framework === "unknown" || a.framework === "static") {
    targets.push("static-site");
    steps.push({ label: "Deploy as static site (mesh node / Caddy)", kind: "deploy", deploy: "static" });
    if (canApk) {
      targets.push("apk");
      steps.push({ label: "Wrap as Android APK", kind: "blueprint", blueprint: "apk-workflow" });
    }
    return { targets, primaryTarget: "static-site", steps, notes };
  }

  if (canStatic) {
    targets.push("static-site");
    steps.push({ label: "Install dependencies", kind: "command", command: install });
    if (a.framework === "next") {
      if (!a.nextConfig.hasEnvToggle) {
        steps.push({
          label: "Add BUILD_STATIC/BUILD_APK toggle to next.config",
          kind: "blueprint",
          blueprint: "export-mode",
          detail: "One-click config patch (backup created automatically).",
        });
      }
      steps.push({ label: "Static export (BUILD_STATIC=1)", kind: "command", command: "BUILD_STATIC=1 " + run + " build" });
    } else if (a.scripts.build) {
      steps.push({ label: "Build", kind: "command", command: run + " build" });
    }
    steps.push({ label: "Deploy static output (mesh node / Caddy)", kind: "deploy", deploy: "static" });
    steps.push({ label: "Publish to Cloudflare Pages (wrangler)", kind: "deploy", deploy: "cf-pages" });
  }

  if (needsSsr) {
    targets.push("node-app");
    steps.push({ label: "Install dependencies", kind: "command", command: install });
    if (a.scripts.build) steps.push({ label: "Build", kind: "command", command: run + " build" });
    steps.push({
      label: "Deploy as Node service (systemd + Caddy reverse proxy)",
      kind: "deploy",
      deploy: "node",
      detail: "Stable port, systemd unit, custom domains via Caddy snippets.",
    });
    notes.push("SSR/API routes detected — a long-running Node process is required.");
  }

  if (canApk) {
    targets.push("apk");
    steps.push({
      label: "Generate the APK pipeline",
      kind: "blueprint",
      blueprint: "apk-workflow",
      detail: "GitHub Actions builds the APK for free; Forge imports it via the Artifacts panel.",
    });
    notes.push("APK: after the Actions build, import the artifact into Forge (Artifacts panel).");
  }

  if (a.framework === "next" || a.framework === "vite") {
    targets.push("gh-actions-build");
    steps.push({
      label: "Optional: run builds on GitHub Actions (free minutes on public repos)",
      kind: "workflow",
      workflow: "build",
      detail: "Offloads heavy builds from the Forge node — zero local resources.",
    });
  }

  const primaryTarget: PlanTarget | null = needsSsr
    ? "node-app"
    : canStatic
      ? "static-site"
      : targets[0] ?? null;

  return { targets, primaryTarget, steps, notes };
}
