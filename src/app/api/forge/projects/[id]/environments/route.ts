// ============================================================
// Forge — deployment environments for a project
// GET  /api/forge/projects/[id]/environments
// POST /api/forge/projects/[id]/environments
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { ok, created, fail, notFound, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

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

    const environments = await db.environment.findMany({
      where: { projectId: id },
      include: {
        deployments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { name: 'asc' },
    });
    return ok(environments);
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
    const project = await db.project.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!project) return notFound('Project not found');

    const body = (await request.json()) as {
      name?: string;
      description?: string;
      requiresApproval?: boolean;
      requiredReviewers?: number;
    };
    const name = (body.name ?? '').trim().toLowerCase();
    if (!NAME_RE.test(name)) {
      return fail('Invalid environment name (a-z, 0-9, dashes; max 40 chars)');
    }

    const existing = await db.environment.findUnique({
      where: { projectId_name: { projectId: id, name } },
    });
    if (existing) return fail(`Environment "${name}" already exists`, 409);

    const environment = await db.environment.create({
      data: {
        projectId: id,
        name,
        description: body.description ?? null,
        requiresApproval: body.requiresApproval ?? false,
        requiredReviewers: body.requiredReviewers ?? 0,
      },
    });

    await audit('environment.created', 'environment', environment.id, undefined, {
      projectId: id,
      name,
    });
    return created(environment);
  } catch (err) {
    return serverError(err);
  }
}
