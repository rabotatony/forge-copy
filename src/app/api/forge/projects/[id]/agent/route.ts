import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { startRunExtended } from "@/lib/forge/engine";
import { getWorkflow } from "@/lib/forge/workflows";
import * as fs from "node:fs";
import * as path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const body = await req.json();
    const action = body.action as string;
    const agentName = (body.agent as string) ?? "unknown-agent";

    switch (action) {
      case "get-files": {
        const root = project.extractedPath;
        const files: { path: string; size: number }[] = [];
        const collect = (dir: string, base: string) => {
          try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".") || e.name === "node_modules") continue;
            const full = path.join(dir, e.name);
            const rel = base ? `${base}/${e.name}` : e.name;
            if (e.isDirectory()) collect(full, rel);
            else files.push({ path: rel, size: fs.statSync(full).size });
          } } catch {}
        };
        collect(root, "");
        return Response.json({ files });
      }
      case "update-files": {
        const files = body.files as Record<string, string>;
        if (!files) return Response.json({ error: "files object is required" }, { status: 400 });
        const root = project.extractedPath;
        let updated = 0, created = 0;
        for (const [relPath, content] of Object.entries(files)) {
          try {
            const full = path.resolve(root, relPath);
            if (full !== root && !full.startsWith(root + path.sep)) continue;
            fs.mkdirSync(path.dirname(full), { recursive: true });
            const existed = fs.existsSync(full);
            fs.writeFileSync(full, content);
            if (existed) updated++; else created++;
          } catch {}
        }
        return Response.json({ ok: true, updated, created });
      }
      case "run-workflow": {
        const workflow = body.workflow as string;
        if (!workflow) return Response.json({ error: "workflow is required" }, { status: 400 });
        const wf = getWorkflow(workflow);
        if (!wf) return Response.json({ error: `Unknown workflow: ${workflow}` }, { status: 400 });
        const { runId } = await startRunExtended({ projectId: id, workflow, trigger: "auto", label: `Agent (${agentName}): ${workflow}` });
        return Response.json({ ok: true, runId, workflow });
      }
      case "get-status": {
        const recentRuns = await db.run.findMany({ where: { projectId: id }, orderBy: { startedAt: "desc" }, take: 10, select: { id: true, workflow: true, status: true, exitCode: true, durationMs: true, startedAt: true } });
        const runCount = await db.run.count({ where: { projectId: id } });
        const successCount = await db.run.count({ where: { projectId: id, status: "success" } });
        return Response.json({ projectId: id, projectName: project.name, totalRuns: runCount, successRate: runCount > 0 ? Math.round((successCount / runCount) * 100) : 0, recentRuns: recentRuns.map(r => ({ ...r, startedAt: r.startedAt.toISOString() })) });
      }
      case "log": {
        const message = body.message as string;
        if (!message) return Response.json({ error: "message is required" }, { status: 400 });
        const logPath = path.join(project.extractedPath, "AGENT_LOG.md");
        try { if (fs.existsSync(logPath)) fs.appendFileSync(logPath, `\n### Session: ${agentName} — ${new Date().toISOString()}\n- **Message**: ${message}\n`); } catch {}
        return Response.json({ ok: true, logged: true });
      }
      default:
        return Response.json({ error: `Unknown action: ${action}. Use: get-files, update-files, run-workflow, get-status, log` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return Response.json({ projectId: (await params).id, endpoint: "POST /api/forge/projects/[id]/agent", actions: ["get-files", "update-files", "run-workflow", "get-status", "log"] });
}
