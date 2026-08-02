// ============================================================
// Forge — workflow dispatch with inputs
// ============================================================
// POST /api/forge/runs/dispatch
//   body: { projectId, workflow, inputs: Record<string, string> }
//   → { runId }
//
// Inputs are injected as env vars (INPUT_<NAME>) + matrix values.
// This matches GitHub Actions "workflow_dispatch" with inputs.
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { startRunExtended } from '@/lib/forge/engine';
import { getWorkflow } from '@/lib/forge/workflows';
import type { Detection, ProjectKind } from '@/lib/forge/detector';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json() as {
      projectId: string;
      workflow: string;
      inputs?: Record<string, string>;
      env?: Record<string, string>;
    };

    if (!body.projectId || !body.workflow) {
      return Response.json({ error: 'projectId and workflow required' }, { status: 400 });
    }

    const project = await db.project.findUnique({ where: { id: body.projectId } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    const wf = getWorkflow(body.workflow);
    if (!wf) return Response.json({ error: `Unknown workflow: ${body.workflow}` }, { status: 400 });

    // Convert inputs to env vars: INPUT_FOO=bar
    const inputEnv: Record<string, string> = {};
    if (body.inputs) {
      for (const [key, value] of Object.entries(body.inputs)) {
        inputEnv[`INPUT_${key.toUpperCase()}`] = value;
      }
    }

    // Merge with explicit env vars.
    const env = { ...inputEnv, ...(body.env ?? {}) };

    const { runId } = await startRunExtended({
      projectId: body.projectId,
      workflow: body.workflow,
      trigger: 'manual',
      env,
      secrets: wf.secrets ?? [],
      timeoutMs: wf.defaultTimeoutMs,
      requiresApproval: wf.requiresApproval ?? false,
      label: body.inputs && Object.keys(body.inputs).length > 0
        ? `Dispatch: ${Object.entries(body.inputs).map(([k, v]) => `${k}=${v}`).join(', ')}`
        : undefined,
    });

    return Response.json({ runId, inputs: body.inputs ?? {} });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
