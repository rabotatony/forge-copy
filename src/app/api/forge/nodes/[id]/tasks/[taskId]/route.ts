// ============================================================
// Forge Mesh — agent reports a task result
// POST /api/forge/nodes/[id]/tasks/[taskId]
// body: { status: "done" | "failed", result?, error? }
// ============================================================
import { NextRequest } from "next/server";
import { ok, unauthorized, notFound, fail, serverError } from "@/lib/forge/response";
import { db } from "@/lib/db";
import { findNodeByIdOrSlug, safeCompareHash, completeTask } from "@/lib/forge/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id, taskId } = await ctx.params;
    const node = await findNodeByIdOrSlug(id);
    if (!node) return notFound("Node not found");
    const secret = req.headers.get("x-forge-node-secret") ?? "";
    if (!secret || !safeCompareHash(secret, node.secretHash)) {
      return unauthorized("Invalid node secret");
    }
    const body = await req.json().catch(() => ({}));
    const status = body.status === "done" ? "done" : body.status === "failed" ? "failed" : null;
    if (!status) return fail("status must be 'done' or 'failed'");
    const task = await db.nodeTask.findFirst({ where: { id: taskId, nodeId: node.id } });
    if (!task) return notFound("Task not found");
    const result = typeof body.result === "string" ? body.result.slice(0, 4000) : null;
    const error = typeof body.error === "string" ? body.error.slice(0, 4000) : null;
    const updated = await completeTask(task.id, status === "done", result, error);
    return ok({ task: { id: updated.id, status: updated.status } });
  } catch (e) {
    return serverError(e);
  }
}
