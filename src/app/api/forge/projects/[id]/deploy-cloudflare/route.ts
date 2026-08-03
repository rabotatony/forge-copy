// ============================================================
// Forge — deploy a project to Cloudflare (sovereign)
// POST /api/forge/projects/[id]/deploy-cloudflare
//   { target: "pages" | "workers", outDir?, workerName? }
// Builds (if needed) and publishes to Cloudflare from the Forge
// node — no GitHub Actions / external CI involved.
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import { db } from "@/lib/db";
import { audit } from "@/lib/forge/audit";
import { getCfCredentials } from "@/lib/forge/cloudflare";
import { deployProjectToCloudflare, type CfDeployTarget } from "@/lib/forge/cf-deploy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const creds = getCfCredentials();
    if (!creds) {
      return Response.json({ error: "Cloudflare not configured. Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID." }, { status: 409 });
    }

    const workspace = project.extractedPath;
    if (!workspace || !fs.existsSync(workspace)) {
      return Response.json({ error: "Project workspace missing" }, { status: 409 });
    }

    const body = (await request.json().catch(() => ({}))) as { target?: string; outDir?: string; workerName?: string };
    const target: CfDeployTarget = body.target === "workers" ? "workers" : "pages";

    const result = await deployProjectToCloudflare({
      workspace,
      projectName: project.name,
      target,
      workerName: body.workerName,
      outDir: body.outDir,
    });

    await audit("deploy.cloudflare", "project", id, "api", { target, ok: result.ok, url: result.url ?? null });

    if (!result.ok) {
      return Response.json({ ok: false, target, log: result.log.slice(-8000) }, { status: 500 });
    }
    return Response.json({ ok: true, target, url: result.url ?? null, log: result.log.slice(-8000) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
