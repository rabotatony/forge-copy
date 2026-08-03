// ============================================================
// Forge - one-click sovereign pipeline
// ============================================================
// POST /api/forge/projects/[id]/sovereign-build
//   {
//     target?: 'cf-pages' | 'none'   // default 'none' (build only)
//     cfProject?: string             // default: slugified project name
//     branch?: string                // default 'main'
//     skipInstall?: boolean
//     env?: Record<string, string>   // extra build env vars
//   }
//
// guard -> install -> build happens on the Forge node itself via
// the hardened child-runner; optionally the static output is
// published straight to Cloudflare Pages (direct upload). No
// external CI is involved anywhere in the chain.
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import { db } from "@/lib/db";
import { extractDir } from "@/lib/forge/storage";
import { audit } from "@/lib/forge/audit";
import {
  guardConfigSanity,
  runSovereignBuild,
  detectToolchain,
} from "@/lib/forge/builders";
import { publishToCloudflarePages } from "@/lib/forge/cf-pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "site"
  );
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    target?: string;
    cfProject?: string;
    branch?: string;
    skipInstall?: boolean;
    env?: Record<string, string>;
  };

  const project = await db.project.findUnique({ where: { id } });
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  const root = extractDir(project.id);
  if (!fs.existsSync(root)) {
    return Response.json(
      { error: "workspace missing - upload or clone the project first" },
      { status: 400 },
    );
  }

  const lines: Array<{ stream: string; text: string }> = [];
  const log = (stream: "stdout" | "stderr", text: string) => {
    if (lines.length < 4000) lines.push({ stream, text });
  };

  // 1. self-healing guard (quarantines unresolvable config files)
  const guard = guardConfigSanity(root, (m) => log("stdout", m));

  // 2. toolchain-aware build
  const tc = detectToolchain(root);
  const env: Record<string, string> = { ...(body.env ?? {}) };
  if (tc.framework === "next" && !env.BUILD_STATIC && !env.BUILD_APK) {
    env.BUILD_STATIC = "1"; // site mode by default
  }
  const build = await runSovereignBuild(root, {
    install: !body.skipInstall,
    env,
    log,
  });

  // 3. optional publish to Cloudflare Pages
  let publish: Awaited<ReturnType<typeof publishToCloudflarePages>> | null = null;
  if (build.ok && body.target === "cf-pages" && build.outputDir) {
    const token =
      process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN ?? "";
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
    if (!token || !accountId) {
      return Response.json(
        {
          error:
            "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not configured on this node",
          toolchain: tc,
          guard,
          build,
          logTail: lines.slice(-200),
        },
        { status: 500 },
      );
    }
    publish = await publishToCloudflarePages(
      {
        projectName: body.cfProject ?? slugify(project.name),
        outDir: build.outputDir,
        branch: body.branch ?? "main",
        log: (m) => log("stdout", m),
      },
      { token, accountId },
    );
  }

  await audit(
    build.ok ? "sovereign-build.ok" : "sovereign-build.failed",
    "project",
    project.id,
    "system",
    {
      framework: tc.framework,
      packageManager: tc.packageManager,
      quarantined: guard.moved,
      publish: publish ? { ok: publish.ok, url: publish.url ?? publish.projectUrl, error: publish.error } : null,
    },
  );

  return Response.json({
    ok: build.ok && (!publish || publish.ok),
    toolchain: tc,
    guard,
    build,
    publish,
    logTail: lines.slice(-200),
  });
}
