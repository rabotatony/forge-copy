// ============================================================
// Forge — scheduled runs (cron jobs) for a project
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { startRunExtended } from '@/lib/forge/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function nextCronRun(cron: string, from: Date): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  const now = new Date(from.getTime());
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() + 1);
  for (let i = 0; i < 525600; i++) {
    if (matchesCron(now, minute!, hour!, dom!, month!, dow!)) return now;
    now.setMinutes(now.getMinutes() + 1);
  }
  return null;
}

function matchesCron(date: Date, minute: string, hour: string, dom: string, month: string, dow: string): boolean {
  return (
    matchesField(minute, date.getMinutes(), 0, 59) &&
    matchesField(hour, date.getHours(), 0, 23) &&
    matchesField(dom, date.getDate(), 1, 31) &&
    matchesField(month, date.getMonth() + 1, 1, 12) &&
    matchesField(dow, date.getDay(), 0, 6)
  );
}

function matchesField(pattern: string, value: number, min: number, max: number): boolean {
  if (pattern === '*') return true;
  for (const part of pattern.split(',')) {
    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const stepNum = parseInt(step!, 10);
      const start = range === '*' ? min : parseInt(range!, 10);
      for (let v = start; v <= max; v += stepNum) {
        if (v === value) return true;
      }
    } else if (part.includes('-')) {
      const [s, e] = part.split('-').map(Number);
      if (value >= s! && value <= e!) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }
  return false;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const schedules = await db.scheduledRun.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
    });
    return Response.json({ schedules });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await req.json() as { workflow: string; cron: string; timezone?: string };
    if (!body.workflow?.trim() || !body.cron?.trim()) {
      return Response.json({ error: 'workflow and cron are required' }, { status: 400 });
    }
    const nextRunAt = nextCronRun(body.cron, new Date());
    if (!nextRunAt) {
      return Response.json({ error: 'Invalid cron expression' }, { status: 400 });
    }
    const schedule = await db.scheduledRun.create({
      data: {
        projectId: id,
        workflow: body.workflow,
        cron: body.cron,
        timezone: body.timezone ?? 'UTC',
        enabled: true,
        nextRunAt,
      },
    });
    return Response.json({ schedule }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Background scheduler.
let schedulerStarted = false;
function startScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(async () => {
    try {
      const due = await db.scheduledRun.findMany({
        where: { enabled: true, nextRunAt: { lte: new Date() } },
      });
      for (const schedule of due) {
        try {
          await startRunExtended({
            projectId: schedule.projectId,
            workflow: schedule.workflow,
            trigger: 'cron',
          });
          const next = nextCronRun(schedule.cron, new Date());
          await db.scheduledRun.update({
            where: { id: schedule.id },
            data: { lastRunAt: new Date(), nextRunAt: next, runCount: { increment: 1 } },
          });
        } catch (err) {
          console.error('[forge:scheduler] run failed:', err);
        }
      }
    } catch (err) {
      console.error('[forge:scheduler] tick failed:', err);
    }
  }, 30_000);
}
startScheduler();
