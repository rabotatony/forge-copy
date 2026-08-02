// ============================================================
// Forge — Workflow step preview
// ============================================================
// GET /api/forge/projects/[id]/workflows/[workflowKey]/preview
//   Returns the steps that a workflow would execute, WITHOUT
//   actually running them. Lets the user see what commands will
//   run before clicking Run.
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getWorkflow } from "@/lib/forge/workflows";
import type { Detection } from "@/lib/forge/detector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; workflowKey: string }> },
): Promise<Response> {
  try {
    const { id, workflowKey } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const workflow = getWorkflow(workflowKey);
    if (!workflow) {
      return Response.json({ error: `Unknown workflow: ${workflowKey}` }, { status: 404 });
    }

    let detection: Detection;
    try {
      detection = JSON.parse(project.detection) as Detection;
    } catch {
      detection = { type: "unknown", hints: [] } as Detection;
    }

    // Build the steps WITHOUT running them
    const steps = workflow.build(detection);
    if (!steps) {
      return Response.json({
        workflow: workflowKey,
        name: workflow.name,
        description: workflow.description,
        steps: [],
        message: "This workflow does not apply to this project.",
      });
    }

    return Response.json({
      workflow: workflowKey,
      name: workflow.name,
      description: workflow.description,
      steps: steps.map((s, i) => ({
        index: i + 1,
        label: s.label,
        command: s.command.slice(0, 500), // truncate long commands for preview
        commandTruncated: s.command.length > 500,
      })),
      metadata: {
        requiresApproval: workflow.requiresApproval ?? false,
        secrets: workflow.secrets ?? [],
        cache: workflow.cache ?? null,
        testReport: workflow.testReport ?? null,
        defaultRetry: workflow.defaultRetry ?? 0,
        defaultTimeoutMs: workflow.defaultTimeoutMs ?? null,
        plugin: (workflow as { plugin?: boolean }).plugin ?? false,
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
