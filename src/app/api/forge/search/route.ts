// ============================================================
// Forge — Global search across all projects
// ============================================================
// GET /api/forge/search?q=query
//   Searches across:
//   - Project names
//   - Project file names
//   - Run workflow names
//   - Log line text
//   Returns unified results.
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim();
    if (!q || q.length < 2) {
      return Response.json({ results: [], query: q ?? "" });
    }

    const query = q.toLowerCase();
    const results: Array<{
      type: "project" | "run" | "log";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    }> = [];

    // Search projects
    const projects = await db.project.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { fileName: { contains: q } },
          { kind: { contains: q } },
        ],
      },
      take: 10,
      select: { id: true, name: true, kind: true, fileName: true },
    });
    for (const p of projects) {
      results.push({
        type: "project",
        id: p.id,
        title: p.name,
        subtitle: `${p.kind} · ${p.fileName}`,
        href: `/?project=${p.id}`,
      });
    }

    // Search runs by workflow name
    const runs = await db.run.findMany({
      where: { workflow: { contains: q } },
      take: 10,
      select: { id: true, workflow: true, status: true, projectId: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    });
    for (const r of runs) {
      results.push({
        type: "run",
        id: r.id,
        title: r.workflow,
        subtitle: `${r.status} · ${r.startedAt.toISOString().slice(0, 10)}`,
        href: `/?run=${r.id}&projectId=${r.projectId}`,
      });
    }

    // Search log lines (limited to recent runs)
    const recentRunIds = await db.run.findMany({
      select: { id: true },
      take: 50,
      orderBy: { startedAt: "desc" },
    });
    if (recentRunIds.length > 0) {
      const logs = await db.logLine.findMany({
        where: {
          runId: { in: recentRunIds.map((r) => r.id) },
          text: { contains: q },
        },
        take: 10,
        select: { id: true, runId: true, text: true, stream: true, seq: true },
      });
      for (const l of logs) {
        results.push({
          type: "log",
          id: l.id,
          title: l.text.slice(0, 80) + (l.text.length > 80 ? "…" : ""),
          subtitle: `${l.stream} · run ${l.runId.slice(0, 12)}`,
          href: `/?run=${l.runId}`,
        });
      }
    }

    // Sort: projects first, then runs, then logs
    const typeOrder = { project: 0, run: 1, log: 2 };
    results.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

    return Response.json({ results, query: q, total: results.length });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
