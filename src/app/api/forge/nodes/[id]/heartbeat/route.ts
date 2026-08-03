// ============================================================
// Forge Mesh — agent heartbeat (outbound-only design)
// POST /api/forge/nodes/[id]/heartbeat
// Auth: x-forge-node-secret header. Updates last-seen/state and
// returns pending tasks for the node to execute.
// ============================================================
import { NextRequest } from "next/server";
import { ok, unauthorized, notFound, serverError } from "@/lib/forge/response";
import { db } from "@/lib/db";
import { findNodeByIdOrSlug, safeCompareHash, claimTasks } from "@/lib/forge/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const node = await findNodeByIdOrSlug(id);
    if (!node) return notFound("Node not found");
    const secret = req.headers.get("x-forge-node-secret") ?? "";
    if (!secret || !safeCompareHash(secret, node.secretHash)) {
      return unauthorized("Invalid node secret");
    }

    const body = await req.json().catch(() => ({}));
    const status =
      typeof body.status === "string" && ["idle", "busy", "degraded"].includes(body.status)
        ? body.status
        : "idle";
    const capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((c: unknown) => typeof c === "string").slice(0, 8)
      : null;
    const labels =
      body.labels && typeof body.labels === "object" && !Array.isArray(body.labels)
        ? body.labels
        : null;
    const version = typeof body.version === "string" ? body.version.slice(0, 64) : null;

    const updated = await db.node.update({
      where: { id: node.id },
      data: {
        lastSeenAt: new Date(),
        status,
        ...(capabilities ? { capabilities: JSON.stringify(capabilities) } : {}),
        ...(labels ? { labels: JSON.stringify(labels) } : {}),
        ...(version ? { version } : {}),
      },
    });

    const tasks = await claimTasks(node.id);
    return ok({
      nodeId: updated.id,
      slug: updated.slug,
      tasks,
      intervalSec: 20,
    });
  } catch (e) {
    return serverError(e);
  }
}
