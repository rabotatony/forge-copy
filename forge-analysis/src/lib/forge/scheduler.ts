// ============================================================
// Forge — scheduled runs scheduler
// ============================================================
// Background scheduler that checks for due scheduled runs every
// 30 seconds and triggers them. Imported by engine.ts so it
// starts automatically when the engine loads.
// ============================================================
import { db } from '@/lib/db';

// Lazy import to avoid circular dependency (engine.ts imports this file).
async function triggerRun(projectId: string, workflow: string): Promise<void> {
  const { startRunExtended } = await import('./engine');
  await startRunExtended({ projectId, workflow, trigger: 'cron' });
}

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

let schedulerStarted = false;

export function startScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(async () => {
    try {
      const due = await db.scheduledRun.findMany({
        where: { enabled: true, nextRunAt: { lte: new Date() } },
      });

      for (const schedule of due) {
        try {
          await triggerRun(schedule.projectId, schedule.workflow);

          const next = nextCronRun(schedule.cron, new Date());
          await db.scheduledRun.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: new Date(),
              nextRunAt: next,
              runCount: { increment: 1 },
            },
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

// Auto-start.
startScheduler();
