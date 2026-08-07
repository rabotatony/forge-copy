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
    return Response.json(await shell(cmd));
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
