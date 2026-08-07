// ============================================================
// Forge — Agent / machine interface
// ============================================================
// A single endpoint an external tool / AI agent (a "complementary
// tool") can call to DO things on Forge: run shell commands, inspect
// capabilities, list projects, read capabilities.
// This turns Forge into the "hands" that an orchestrator lacks.
//
// POST /api/forge/agent  { action, ... }
//   action: "inspect" | "run" | "projects" | "capabilities"
// ============================================================
import type { NextRequest } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { selectNode, createTask } from "@/lib/forge/mesh";
import * as fs from "node:fs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const run = promisify(exec);

async function shell(cmd: string) {
  try {
    const { stdout, stderr } = await run(cmd, { timeout: 50000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (e: any) {
    return { ok: false, stdout: e?.stdout ?? "", stderr: e?.stderr ?? "", error: String(e?.message ?? e) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function meshRun(cmd: string) {
  try {
    const node = await selectNode([]);
    if (!node) return null;
    const task = await createTask((node as any).id, "cmd", { command: cmd });
    for (let i = 0; i < 22; i++) {
      await sleep(2000);
      const t = await db.nodeTask.findUnique({ where: { id: task.id } });
      if (t && (t.status === "done" || t.status === "failed")) {
        return { ok: t.status === "done", stdout: t.result ?? "", stderr: t.error ?? "", via: "mesh", node: (node as any).slug };
      }
    }
    return { ok: false, error: "mesh task still running", via: "mesh", taskId: task.id };
  } catch { return null; }
}

function caps() {
  let filesystem = false, child = false;
  try { filesystem = fs.existsSync("/"); } catch {}
  return { filesystem, child };
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action ?? "inspect");

  if (action === "run") {
    const cmd = String(body.cmd ?? "");
    if (!cmd) return Response.json({ error: "cmd required" }, { status: 400 });
    const local = await shell(cmd);
    // If child_process is unavailable (edge), fall back to a mesh node.
    if (!local.ok && /not implemented|unenv/i.test(String(local.error ?? ""))) {
      const m = await meshRun(cmd);
      if (m) return Response.json(m);
    }
    return Response.json(local);
  }

  if (action === "capabilities") {
    let child = false;
    try { await run("true", { timeout: 5000 }); child = true; } catch {}
    const c = caps();
    return Response.json({ filesystem: c.filesystem, childProcess: child, localBuilds: c.filesystem && child });
  }

  if (action === "projects") {
    try {
      const projects = await db.project.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
      return Response.json({ projects });
    } catch { return Response.json({ projects: [] }); }
  }

  // inspect (default)
  let child = false;
  try { await run("true", { timeout: 5000 }); child = true; } catch {}
  const c = caps();
  let projects: any[] = [];
  try { projects = await db.project.findMany({ take: 10, orderBy: { createdAt: "desc" } }); } catch {}
  return Response.json({
    forge: "agent-interface",
    compute: { filesystem: c.filesystem, childProcess: child, localBuilds: c.filesystem && child },
    projects: projects.map((p: any) => ({ id: p.id, name: p.name, kind: p.kind, files: p.fileCount })),
    actions: ["inspect", "run", "projects", "capabilities"],
  });
}
