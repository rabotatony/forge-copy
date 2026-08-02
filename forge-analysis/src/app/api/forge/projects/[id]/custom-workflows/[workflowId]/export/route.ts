// ============================================================
// Forge — export a custom workflow as a downloadable JSON file
// ============================================================
// Returns a portable workflow definition that can be shared
// across projects and re-imported via the matching /import route.
// The payload schema is intentionally a strict subset of the full
// CustomWorkflow type so that secrets/matrix/etc. are not leaked
// when a workflow is shared between projects.
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import type { CustomWorkflow } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORGE_VERSION = 'v32';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; workflowId: string }> },
): Promise<Response> {
  try {
    const { id, workflowId } = await params;

    const pipeline = await db.pipeline.findUnique({ where: { id: workflowId } });
    if (!pipeline || pipeline.projectId !== id) {
      return Response.json({ error: 'Custom workflow not found' }, { status: 404 });
    }

    let parsed: { customWorkflow?: CustomWorkflow };
    try {
      parsed = JSON.parse(pipeline.config) as { customWorkflow?: CustomWorkflow };
    } catch {
      return Response.json({ error: 'Invalid custom workflow config' }, { status: 500 });
    }
    if (!parsed.customWorkflow) {
      return Response.json({ error: 'Pipeline is not a custom workflow' }, { status: 400 });
    }

    const wf = parsed.customWorkflow;

    // Portable subset: name, description, steps, env.
    // Step definitions include everything authored so the workflow
    // behaves identically when re-imported.
    const portableSteps = (wf.steps ?? []).map((s) => {
      const step: Record<string, unknown> = { name: s.name, run: s.run };
      if (s.workingDir !== undefined) step.workingDir = s.workingDir;
      if (s.env !== undefined) step.env = s.env;
      if (s.retry !== undefined) step.retry = s.retry;
      if (s.timeoutMs !== undefined) step.timeoutMs = s.timeoutMs;
      if (s.cache !== undefined) step.cache = s.cache;
      if (s.testReport !== undefined) step.testReport = s.testReport;
      if (s.continueOnError !== undefined) step.continueOnError = s.continueOnError;
      return step;
    });

    const portableWorkflow: Record<string, unknown> = {
      name: wf.name,
      steps: portableSteps,
    };
    if (wf.description !== undefined) portableWorkflow.description = wf.description;
    if (wf.env !== undefined) portableWorkflow.env = wf.env;

    const payload = {
      workflow: portableWorkflow,
      exportedAt: new Date().toISOString(),
      forgeVersion: FORGE_VERSION,
    };

    // Sanitize the workflow name for use in a filename.
    const safeName = (wf.name ?? 'workflow')
      .trim()
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'workflow';
    const filename = `workflow-${safeName}.json`;

    const json = JSON.stringify(payload, null, 2);

    return new Response(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
