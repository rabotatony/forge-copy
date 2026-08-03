// ============================================================
// Forge — deployments for a project
// GET  /api/forge/projects/[id]/deployments  — history
// POST /api/forge/projects/[id]/deployments  — publish now
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import { db } from '@/lib/db';
import { ok, created, fail, notFound, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';
import { extractDir, runArtifactDir } from '@/lib/forge/storage';
import {
  projectSlug,
  publishRelease,
  provisionCaddySite,
  resolveOutputDir,
} from '@/lib/forge/deploy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!project) return notFound('Project not found');

    const deployments = await db.deployment.findMany({
      where: { environment: { projectId: id } },
      include: { environment: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return ok(deployments);
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
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return notFound('Project not found');

    const body = (await request.json()) as {
      environmentId?: string;
      source?: 'workspace' | 'run';
      runId?: string;
      outputDir?: string;
      deployedBy?: string;
    };
    if (!body.environmentId) return fail('Missing environmentId');

    const environment = await db.environment.findFirst({
      where: { id: body.environmentId, projectId: id },
    });
    if (!environment) return notFound('Environment not found');

    // ---- Resolve the source root -------------------------------
    let rootDir: string;
    if (body.source === 'run') {
      if (!body.runId) return fail('source=run requires runId');
      const run = await db.run.findFirst({
        where: { id: body.runId, projectId: id },
      });
      if (!run) return notFound('Run not found');
      rootDir = runArtifactDir(run.id);
    } else {
      rootDir =
        project.extractedPath && fs.existsSync(project.extractedPath)
          ? project.extractedPath
          : extractDir(project.id);
    }

    let sourceDir: string;
    try {
      sourceDir = resolveOutputDir(rootDir, body.outputDir);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
    if (!fs.existsSync(sourceDir)) {
      return fail(`Output directory not found: ${body.outputDir || '(root)'}`);
    }

    // ---- Create the deployment record ---------------------------
    const deployment = await db.deployment.create({
      data: {
        environmentId: environment.id,
        runId: body.runId ?? null,
        status: 'in_progress',
        deployedBy: body.deployedBy ?? null,
      },
    });

    try {
      const slug = projectSlug(project);
      const result = publishRelease({
        slug,
        sourceDir,
        meta: {
          projectId: project.id,
          environment: environment.name,
          deploymentId: deployment.id,
        },
      });
      const { host } = provisionCaddySite({ slug, mode: 'static' });

      const url = result.url;
      if (url && url !== environment.url) {
        await db.environment.update({
          where: { id: environment.id },
          data: { url },
        });
      }
      const updated = await db.deployment.update({
        where: { id: deployment.id },
        data: { status: 'success', version: result.version, deployedAt: new Date() },
      });

      await audit('deploy.created', 'deployment', updated.id, undefined, {
        projectId: project.id,
        environment: environment.name,
        version: result.version,
        files: result.files,
        bytes: result.bytes,
        host,
      });

      return created({
        ...updated,
        url,
        host,
        files: result.files,
        bytes: result.bytes,
      });
    } catch (err) {
      await db.deployment
        .update({ where: { id: deployment.id }, data: { status: 'failed' } })
        .catch(() => {});
      return serverError(err);
    }
  } catch (err) {
    return serverError(err);
  }
}
