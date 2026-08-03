// ============================================================
// Forge — single deployment
// GET    /api/forge/deployments/[id] — details + site releases
// DELETE /api/forge/deployments/[id] — remove the record
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, notFound, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';
import { listReleases, projectSlug } from '@/lib/forge/deploy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const deployment = await db.deployment.findUnique({
      where: { id },
      include: {
        environment: {
          include: { project: { select: { id: true, name: true } } },
        },
      },
    });
    if (!deployment) return notFound('Deployment not found');

    const slug = projectSlug(deployment.environment.project);
    let releases: unknown[] = [];
    try {
      releases = listReleases(slug);
    } catch {
      // site dir may not exist yet
    }

    return ok({ ...deployment, slug, releases });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const deployment = await db.deployment.findUnique({ where: { id } });
    if (!deployment) return notFound('Deployment not found');

    await db.deployment.delete({ where: { id } });
    await audit('deploy.deleted', 'deployment', id, undefined, {
      environmentId: deployment.environmentId,
      version: deployment.version,
    });
    return ok({ deleted: true });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}
