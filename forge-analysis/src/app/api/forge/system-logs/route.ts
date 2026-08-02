// ============================================================
// Forge — system logs viewer
//
// Returns recent system events across ALL projects:
//   - last 50 runs (any project), ordered by startedAt DESC
//   - for each run, fetch the last 3 "system" stream log lines
//   - flatten into a single events array sorted by ts DESC
//
// Response shape:
//   { events: Array<{ id, runId, projectId, projectName, workflow,
//                     status, stream, text, ts }> }
// ============================================================
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SystemEvent {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  workflow: string;
  status: string;
  stream: string;
  text: string;
  ts: string;
}

export async function GET(): Promise<Response> {
  try {
    // Last 50 runs across all projects, newest first.
    const runs = await db.run.findMany({
      take: 50,
      orderBy: { startedAt: 'desc' },
      include: {
        project: { select: { name: true } },
      },
    });

    // For each run, grab the last 3 "system" stream log lines.
    const perRunLogPromises = runs.map((run) =>
      db.logLine
        .findMany({
          where: { runId: run.id, stream: 'system' },
          orderBy: { ts: 'desc' },
          take: 3,
        })
        .then((lines) => ({ run, lines })),
    );

    const perRun = await Promise.all(perRunLogPromises);

    // Flatten run + log lines into a single events array.
    const events: SystemEvent[] = [];
    for (const { run, lines } of perRun) {
      for (const line of lines) {
        events.push({
          id: line.id,
          runId: run.id,
          projectId: run.projectId,
          projectName: run.project.name,
          workflow: run.workflow,
          status: run.status,
          stream: line.stream,
          text: line.text,
          ts: line.ts.toISOString(),
        });
      }
    }

    // Sort by ts DESC (newest first).
    events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

    return Response.json({ events });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
