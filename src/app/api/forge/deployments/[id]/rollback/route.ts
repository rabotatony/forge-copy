// ============================================================
// Forge — rollback to a previous deployment
// POST /api/forge/deployments/[id]/rollback
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { created, fail, notFound, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';
import { projectSlug, rollbackToVersion } from '@/lib/forge/deploy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
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
    if (!deployment.version) return fail('Deployment has no stored version');

    const slug = projectSlug(deployment.environment.project);

    try {
      rollbackToVersion(slug, deployment.version);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    const record = await db.deployment.create({
      data: {
        environmentId: deployment.environmentId,
        runId: deployment.runId,
        status: 'success',
        version: deployment.version,
        deployedAt: new Date(),
        deployedBy: 'rollback',
        rollbackOfId: deployment.id,
      },
    });

    await audit('deploy.rollback', 'deployment', record.id, undefined, {
      environmentId: deployment.environmentId,
      version: deployment.version,
      rollbackOfId: deployment.id,
      slug,
    });

    return created(record);
  } catch (err) {
    return serverError(err);
  }
}
