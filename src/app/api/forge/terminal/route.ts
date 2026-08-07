// ============================================================
// Forge — web terminal with MESH fallback (execution everywhere)
// ============================================================
// POST /api/forge/terminal { cmd }
// 1) If local child_process exists -> run locally.
// 2) Else (edge) -> delegate to an ONLINE mesh node and wait for the
//    result (synchronous-over-mesh). This removes the "no execution
//    on edge" limit: the edge link gains real execution via the mesh.
// ============================================================
import type { NextRequest } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { selectNode, createTask } from "@/lib/forge/mesh";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const run = promisify(exec);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function viaMesh(cmd: string) {
  const node = await selectNode([]);
  if (!node) return null;
  const task = await createTask((node as any).id, "cmd", { command: cmd });
  // poll for completion (bounded)
  for (let i = 0; i < 22; i++) {
    await sleep(2000);
    const t = await db.nodeTask.findUnique({ where: { id: task.id } });
    if (t && (t.status === "done" || t.status === "failed")) {
      return { ok: t.status === "done", stdout: t.result ?? "", stderr: t.error ?? "", via: "mesh", node: (node as any).slug };
    }
  }
  return { ok: false, stdout: "", stderr: "mesh task still running", via: "mesh", taskId: task.id };
}

export async function POST(req: NextRequest): Promise<Response> {
  let cmd = ""; let cwd: string | undefined;
  try { const b = await req.json(); cmd = String(b.cmd ?? ""); cwd = b.cwd || undefined; } catch {}
  if (!cmd) return Response.json({ error: "cmd required" }, { status: 400 });

  // 1) local
  try {
    const { stdout, stderr } = await run(cmd, { cwd, timeout: 50000, maxBuffer: 8 * 1024 * 1024 });
    return Response.json({ ok: true, stdout, stderr, via: "local" });
  } catch (e: any) {
    // if it's a real command failure (not missing child_process), report it
    if (e && (e.stdout !== undefined || e.code !== "ERR_UNKNOWN_BUILTIN")) {
      // fall through to mesh only if child_process truly unavailable
    }
  }

  // 2) mesh fallback (edge)
  try {
    const m = await viaMesh(cmd);
    if (m) return Response.json(m);
  } catch {}

  return Response.json({ ok: false, error: "No local compute and no online mesh node. Join a node (agent.sh) to enable execution." }, { status: 501 });
}
