// ============================================================
// Forge — mesh build dispatcher (sovereign distributed compute)
// ============================================================
// POST /api/forge/mesh-build  { command | source_url, projectId? }
// Picks an ONLINE mesh node and enqueues the build as a task.
// The node agent (public/mesh/agent.sh) executes it and reports back.
// If no node is online -> { via:"none" } so the caller falls back to GHA.
//
// GET /api/forge/mesh-build?taskId=..&nodeId=..  -> task status/result
// ============================================================
import type { NextRequest } from "next/server";
import { selectNode, createTask, listNodes, meshSummary } from "@/lib/forge/mesh";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const command = String(b.command ?? "");
  if (!command) return Response.json({ error: "command required" }, { status: 400 });

  const node = await selectNode([]); // any online node
  if (!node) {
    const nodes = await listNodes();
    return Response.json({ via: "none", mesh: meshSummary(nodes), fallback: "gha" });
  }
  const task = await createTask((node as any).id, "cmd", { command });
  return Response.json({ via: "mesh", nodeId: (node as any).id, nodeSlug: (node as any).slug, taskId: task.id });
}

export async function GET(req: NextRequest): Promise<Response> {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    const nodes = await listNodes();
    return Response.json({ mesh: meshSummary(nodes), nodes });
  }
  try {
    const task = await db.nodeTask.findUnique({ where: { id: taskId } });
    if (!task) return Response.json({ error: "task not found" }, { status: 404 });
    return Response.json({ id: task.id, status: task.status, result: task.result, error: task.error });
  } catch {
    return Response.json({ error: "task lookup failed" }, { status: 500 });
  }
}
