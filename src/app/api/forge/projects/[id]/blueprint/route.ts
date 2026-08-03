// ============================================================
// Forge — Build Intelligence: blueprint application
// POST /api/forge/projects/[id]/blueprint
// body: { action: 'export-mode' | 'capacitor' | 'apk-workflow' | 'all' }
// Writes generated configuration into the project workspace.
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import { db } from '@/lib/db';
import { ok, fail, notFound, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';
import { extractDir } from '@/lib/forge/storage';
import { analyzeProject } from '@/lib/forge/analyzer';
import { applyBlueprint, type BlueprintAction } from '@/lib/forge/blueprint';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACTIONS: BlueprintAction[] = ['export-mode', 'capacitor', 'apk-workflow', 'all'];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return notFound('Project not found');

    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const action = (body.action ?? 'all') as BlueprintAction;
    if (!ACTIONS.includes(action)) return fail(`Unknown action: ${action}`);

    const root = extractDir(id);
    if (!fs.existsSync(root)) return fail('Workspace not extracted yet', 409);

    const analysis = analyzeProject(root);
    const result = applyBlueprint(root, analysis, action);
    if (!result.ok) return fail(result.error ?? 'Blueprint failed', 500);

    await audit('project.blueprint', 'project', id, 'user', { action, changes: result.changes.length });
    return ok({ projectId: id, action, ...result, analysis });
  } catch (err) {
    return serverError(err);
  }
}
