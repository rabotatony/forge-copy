
// ============================================================
// Forge — node app service control (systemd)
// GET  /api/forge/projects/[id]/service           — status
// POST /api/forge/projects/[id]/service           — { action }
//      action: 'start' | 'stop' | 'restart'
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, notFound, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';
import { projectSlug, serviceControl, serviceStatus } from '@/lib/forge/deploy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return notFound('Project not found');
    return ok(serviceStatus(projectSlug(project)));
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

    const body = (await request.json()) as { action?: string };
    const action = body.action;
    if (action !== 'start' && action !== 'stop' && action !== 'restart') {
      return fail('action must be start | stop | restart');
    }

    const slug = projectSlug(project);
    const result = serviceControl(slug, action);

    await audit('deploy.service', 'deployment', slug, undefined, {
      projectId: project.id,
      action,
      ok: result.ok,
      serviceName: result.serviceName,
    });

    return ok(result);
  } catch (err) {
    return serverError(err);
  }
}
