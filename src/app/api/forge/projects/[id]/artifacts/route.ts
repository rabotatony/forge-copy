// ============================================================
// Forge — project artifacts (registry)
// GET  /api/forge/projects/[id]/artifacts                 — list
// GET  /api/forge/projects/[id]/artifacts?source=workflow — GitHub Actions artifacts
// POST /api/forge/projects/[id]/artifacts                 — import {mode:'workflow'|'url'}
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, created, fail, notFound, serverError } from "@/lib/forge/response";
import { audit } from "@/lib/forge/audit";
import {
  listWorkflowArtifacts,
  importWorkflowArtifact,
  importFromUrl,
} from "@/lib/forge/artifact-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({
      where: { id },
      select: { id: true, repoUrl: true },
    });
    if (!project) return notFound("Project not found");

    const source = request.nextUrl.searchParams.get("source");
    if (source === "workflow") {
      const runId = request.nextUrl.searchParams.get("runId");
      const artifacts = await listWorkflowArtifacts(id, runId ? Number(runId) : undefined);
      return ok({ projectRepo: project.repoUrl ?? null, artifacts });
    }

    const artifacts = await db.artifact.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok(artifacts);
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return notFound("Project not found");

    const body = (await request.json()) as {
      mode?: "workflow" | "url";
      artifactApiId?: number;
      name?: string;
      url?: string;
    };

    if (body.mode === "workflow") {
      if (!body.artifactApiId || !body.name) return fail("workflow import needs artifactApiId + name");
      const res = await importWorkflowArtifact(id, {
        artifactApiId: Number(body.artifactApiId),
        name: String(body.name),
      });
      await audit("artifact.imported", "project", id, "api", {
        mode: "workflow",
        name: body.name,
        artifactId: res.artifactId,
      });
      return created(res);
    }

    if (body.mode === "url") {
      if (!body.url) return fail("url import needs url");
      const res = await importFromUrl(id, String(body.url), body.name ? String(body.name) : undefined);
      await audit("artifact.imported", "project", id, "api", {
        mode: "url",
        url: body.url,
        artifactId: res.artifactId,
      });
      return created(res);
    }

    return fail("mode must be 'workflow' or 'url'");
  } catch (err) {
    return serverError(err);
  }
}
