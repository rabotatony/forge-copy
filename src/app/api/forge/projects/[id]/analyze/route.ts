// ============================================================
// Forge — Build Intelligence: project analysis
// GET  /api/forge/projects/[id]/analyze — capability analysis
// POST /api/forge/projects/[id]/analyze — same + audit trail
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import { db } from '@/lib/db';
import { ok, notFound, fail, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';
import { extractDir } from '@/lib/forge/storage';
import { analyzeProject } from '@/lib/forge/analyzer';
import { preflightApk } from '@/lib/forge/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(id: string): Promise<Response> {
  const project = await db.project.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!project) return notFound('Project not found');
  const root = extractDir(id);
  if (!fs.existsSync(root)) return fail('Workspace not extracted yet', 409);
  const analysis = analyzeProject(root);
  return ok({ projectId: id, name: project.name, analysis, preflight: { apk: preflightApk(analysis) } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    return await handle(id);
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    await audit('project.analyze', 'project', id, 'user');
    return await handle(id);
  } catch (err) {
    return serverError(err);
  }
}
