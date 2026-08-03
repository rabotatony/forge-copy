// ============================================================
// Forge — bring ANY repo into Forge, end-to-end
// ============================================================
// POST /api/forge/deploy-repo
//   body: { url, branch?, name?, depth?, enableLive? }
// Clones a repository into a Forge project workspace, runs
// detection + capability analysis, builds the universal plan, and
// (optionally) enables live mode so the preview link is live.
// Everything runs on the Forge node — no external CI required.
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import { db } from "@/lib/db";
import { projectDir, extractDir, ensureDirs } from "@/lib/forge/storage";
import { detectProject } from "@/lib/forge/detector";
import { analyzeProject } from "@/lib/forge/analyzer";
import { planForAnalysis } from "@/lib/forge/universal";
import { cloneRepo, detectProvider } from "@/lib/forge/git";
import { isForbiddenUrl } from "@/lib/forge/security";
import { setLiveState, runLiveBuild } from "@/lib/forge/live";
import { audit } from "@/lib/forge/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DeployRepoBody {
  url: string;
  branch?: string;
  name?: string;
  depth?: number;
  enableLive?: boolean;
}

function deriveNameFromUrl(url: string): string {
  try {
    const cleaned = url.replace(/\.git$/, "");
    const last = cleaned.split("/").filter(Boolean).pop() ?? "";
    return last || "cloned-project";
  } catch {
    return "cloned-project";
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    ensureDirs();

    let body: DeployRepoBody;
    try {
      body = (await request.json()) as DeployRepoBody;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return Response.json({ error: "Missing required field: url" }, { status: 400 });

    const schemeOk = url.startsWith("http://") || url.startsWith("https://") || url.startsWith("git@");
    if (!schemeOk) {
      return Response.json({ error: "URL must start with http://, https://, or git@" }, { status: 400 });
    }
    if (isForbiddenUrl(url)) {
      return Response.json({ error: "URL points to a forbidden (private/internal) address" }, { status: 400 });
    }

    const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : undefined;
    let depth = 1;
    if (body.depth !== undefined && body.depth !== null) {
      const d = typeof body.depth === "number" ? body.depth : Number(body.depth);
      if (!Number.isInteger(d) || d <= 0) {
        return Response.json({ error: "depth must be a positive integer" }, { status: 400 });
      }
      depth = d;
    }

    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const dir = projectDir(projectId);
    const extract = extractDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(extract, { recursive: true });

    const clone = await cloneRepo(url, extract, { branch, depth, timeoutMs: 180_000 });
    if (clone.exitCode !== 0) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      const msg = (clone.stderr || "").trim() || `git clone exited with code ${clone.exitCode}`;
      return Response.json({ error: `git clone failed: ${msg.slice(-500)}` }, { status: 400 });
    }

    const detection = detectProject(extract);
    let analysis = null;
    let plan = null;
    try {
      analysis = analyzeProject(extract);
      plan = planForAnalysis(analysis);
    } catch { /* best-effort */ }

    const rawName = (typeof body.name === "string" ? body.name.trim() : "") || deriveNameFromUrl(url);
    const projectName = rawName.replace(/[\x00-\x1f\x7f]/g, "").replace(/[<>:"'`]/g, "").slice(0, 200) || "cloned-project";
    const fileName = deriveNameFromUrl(url) + ".git";

    const project = await db.project.create({
      data: {
        id: projectId,
        name: projectName,
        fileName,
        extractedPath: extract,
        fileSize: detection.totalBytes,
        fileCount: detection.fileCount,
        kind: detection.kind,
        detection: JSON.stringify(detection.detection),
        repoUrl: url,
        repoBranch: branch ?? null,
        repoProvider: detectProvider(url),
        repoDepth: depth,
        lastFetchAt: new Date(),
      },
    });

    if (body.enableLive) {
      setLiveState(projectId, { enabled: true });
      runLiveBuild(projectId).catch(() => {});
    }

    await audit("project.deploy-repo", "project", projectId, "api", { url, branch: branch ?? null });

    return Response.json({
      project: {
        id: project.id,
        name: project.name,
        kind: project.kind,
        fileCount: project.fileCount,
        fileSize: project.fileSize,
        repoUrl: project.repoUrl,
        repoBranch: project.repoBranch,
        createdAt: project.createdAt.toISOString(),
      },
      analysis,
      plan,
      live: {
        enabled: Boolean(body.enableLive),
        previewUrl: `/api/forge/projects/${project.id}/preview/`,
        controlUrl: `/api/forge/projects/${project.id}/live`,
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
