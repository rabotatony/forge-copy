// ============================================================
// Forge Mesh — single node API
// GET    /api/forge/nodes/[id] — node details + recent tasks
// DELETE /api/forge/nodes/[id] — remove node and its tasks
// ============================================================
import { NextRequest } from "next/server";
import { ok, notFound, serverError } from "@/lib/forge/response";
import { audit } from "@/lib/forge/audit";
import { db } from "@/lib/db";
import { findNodeByIdOrSlug, normalizeNode } from "@/lib/forge/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const node = await findNodeByIdOrSlug(id);
    if (!node) return notFound("Node not found");
    const tasks = await db.nodeTask.findMany({
      where: { nodeId: node.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return ok({
      node: normalizeNode(node as unknown as Record<string, unknown>),
      tasks: tasks.map((task) => ({
        ...task,
        payload: JSON.parse(task.payload || "{}"),
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const node = await findNodeByIdOrSlug(id);
    if (!node) return notFound("Node not found");
    await db.nodeTask.deleteMany({ where: { nodeId: node.id } });
    await db.node.delete({ where: { id: node.id } });
    await audit("node.delete", "node", node.id, "api", { slug: node.slug });
    return ok({ deleted: node.slug });
  } catch (e) {
    return serverError(e);
  }
}
