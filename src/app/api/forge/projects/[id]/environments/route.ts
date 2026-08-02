// ============================================================
// Forge — deployment environments
// ============================================================
// GET  /api/forge/projects/[id]/environments       — list environments
// POST /api/forge/projects/[id]/environments       — create environment
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const envs = await db.environment.findMany({
      where: { projectId: id },
      include: { deployments: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { name: 'asc' },
    });
    return Response.json({ environments: envs });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await req.json() as {
      name: string;
      description?: string;
      requiresApproval?: boolean;
      requiredReviewers?: number;
      url?: string;
    };
    if (!body.name?.trim()) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }
    const env = await db.environment.create({
      data: {
        projectId: id,
        name: body.name.trim(),
        description: body.description ?? null,
        requiresApproval: body.requiresApproval ?? false,
        requiredReviewers: body.requiredReviewers ?? 0,
        url: body.url ?? null,
      },
    });
    return Response.json({ environment: env }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
