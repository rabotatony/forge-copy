
// ============================================================
// Forge — deployments for a project
// GET  /api/forge/projects/[id]/deployments  — history
// POST /api/forge/projects/[id]/deployments  — publish now
//
// POST body:
//   environmentId  required
//   source         'workspace' | 'run'        (default: workspace)
//   runId          required when source='run'
//   outputDir      e.g. 'dist' or '.next/standalone'
//   kind           'static' | 'node'          (default: static)
//   startCommand   node only, e.g. 'node server.js' (default)
//   hosts          node only: custom domains, e.g. ['shoshana.app']
//   deployedBy     optional label
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
  publishNodeRelease,
  provisionCaddySite,
  resolveOutputDir,
  serviceControl,
  isValidHost,
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
      kind?: 'static' | 'node';
      startCommand?: string;
      hosts?: string[];
    };
    if (!body.environmentId) return fail('Missing environmentId');

    const kind = body.kind === 'node' ? 'node' : 'static';

    const environment = await db.environment.findFirst({
      where: { id: body.environmentId, projectId: id },
    });
    if (!environment) return notFound('Environment not found');

    // ---- Validate custom hosts (node apps) ---------------------
    const hosts: string[] = [];
    if (kind === 'node' && Array.isArray(body.hosts)) {
      for (const h of body.hosts.slice(0, 8)) {
        const host = String(h).trim().toLowerCase();
        if (!host) continue;
        if (!isValidHost(host)) return fail(`Invalid host: ${host}`);
        hosts.push(host);
      }
    }

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

      if (kind === 'node') {
        // ---------- Node app deploy -----------------------------
        const result = publishNodeRelease({
          slug,
          sourceDir,
          startCommand: body.startCommand,
          meta: {
            projectId: project.id,
            environment: environment.name,
            deploymentId: deployment.id,
            hosts,
          },
        });

        const { host } = provisionCaddySite({
          slug,
          mode: 'app',
          upstreamPort: result.port,
          aliases: hosts,
        });

        // Best-effort (re)start of the systemd service. When Forge
        // has no permission for systemctl we return manual commands.
        const service = serviceControl(slug, 'restart');

        const url = hosts.length > 0 ? `https://${hosts[0]}` : result.url;
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
          kind: 'node',
          version: result.version,
          files: result.files,
          bytes: result.bytes,
          port: result.port,
          host,
          hosts,
          serviceOk: service.ok,
        });

        return created({
          ...updated,
          kind: 'node',
          url,
          host,
          hosts,
          port: result.port,
          serviceName: result.serviceName,
          service,
          files: result.files,
          bytes: result.bytes,
        });
      }

      // ---------- Static deploy ---------------------------------
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
        kind: 'static',
        version: result.version,
        files: result.files,
        bytes: result.bytes,
        host,
      });

      return created({
        ...updated,
        kind: 'static',
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
