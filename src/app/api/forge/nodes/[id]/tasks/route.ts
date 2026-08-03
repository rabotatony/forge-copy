// ============================================================
// Forge Mesh — enqueue a task for a node
// POST /api/forge/nodes/[id]/tasks
// body: { kind: "deploy_static" | "deploy_node" | "run_command",
//         payload: { ... } }
// ============================================================
import { NextRequest } from "next/server";
import { created, fail, notFound, serverError } from "@/lib/forge/response";
import { audit } from "@/lib/forge/audit";
import { findNodeByIdOrSlug, createTask } from "@/lib/forge/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const TASK_KINDS = ["deploy_static", "deploy_node", "run_command"] as const;

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const node = await findNodeByIdOrSlug(id);
    if (!node) return notFound("Node not found");
    const body = await req.json().catch(() => ({}));
    const kind = (TASK_KINDS as readonly string[]).includes(body.kind) ? body.kind : null;
    if (!kind) return fail("kind must be one of: " + TASK_KINDS.join(", "));
    const payload =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? body.payload
        : {};
    if (kind === "deploy_static" && typeof payload.url !== "string") {
      return fail("deploy_static requires payload.url");
    }
    const task = await createTask(node.id, kind, payload as Record<string, unknown>);
    await audit("node.task.create", "node", node.id, "api", { kind, taskId: task.id });
    return created({ task });
  } catch (e) {
    return serverError(e);
  }
}
