// ============================================================
// Forge — project activity feed (timeline)
// ============================================================
// Returns a merged timeline of runs + audit-log events for the
// project, newest first. Consumed by <ActivityTimeline/>.
//
// GET /api/forge/projects/[id]/activity-feed
// -> { projectId, projectName, timeline: ActivityItem[], total }
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ActivityItem {
  id: string;
  type: "run" | "audit";
  title: string;
  subtitle: string;
  status?: string;
  timestamp: string;
  durationMs?: number | null;
  runId?: string;
  trigger?: string;
  icon: string;
}

const LIMIT = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      select: { id: true, name: true, fileName: true },
    });
    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const [runs, audits] = await Promise.all([
      db.run.findMany({
        where: { projectId: id },
        orderBy: { startedAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          workflow: true,
          status: true,
          startedAt: true,
          durationMs: true,
          trigger: true,
        },
      }),
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          action: true,
          entityId: true,
          entityType: true,
          actor: true,
          createdAt: true,
        },
      }),
    ]);

    const timeline: ActivityItem[] = [];

    for (const r of runs) {
      timeline.push({
        id: `run-${r.id}`,
        type: "run",
        title: r.workflow,
        subtitle: r.trigger === "manual" ? "Manual run" : `Triggered by ${r.trigger}`,
        status: r.status,
        timestamp: r.startedAt.toISOString(),
        durationMs: r.durationMs ?? null,
        runId: r.id,
        trigger: r.trigger,
        icon: r.status === "success" ? "CheckCircle2" : r.status === "failed" ? "XCircle" : "Play",
      });
    }

    for (const a of audits) {
      timeline.push({
        id: `audit-${a.id}`,
        type: "audit",
        title: a.action,
        subtitle: a.actor ? `by ${a.actor}` : "System",
        timestamp: a.createdAt.toISOString(),
        runId: a.entityType === "run" && a.entityId ? a.entityId : undefined,
        icon: "ScrollText",
      });
    }

    timeline.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

    return Response.json({
      projectId: project.id,
      projectName: project.name || project.fileName,
      timeline: timeline.slice(0, LIMIT),
      total: timeline.length,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
