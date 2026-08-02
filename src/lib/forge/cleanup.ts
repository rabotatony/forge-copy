// ============================================================
// Forge — log rotation / cleanup
// ============================================================
// Periodically cleans up old runs + logs to prevent unbounded
// DB growth. Called automatically on a timer.
// ============================================================
import { db } from '@/lib/db';

const RETENTION_DAYS = 30;
const MAX_RUNS_PER_PROJECT = 500;

let cleanupStarted = false;

export function startLogRotation(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;

  // Run cleanup every hour.
  setInterval(async () => {
    try {
      await cleanupOldRuns();
    } catch (err) {
      console.error('[forge:cleanup] failed:', err);
    }
  }, 60 * 60 * 1000); // 1 hour

  // Also run once on startup (after 30s delay).
  setTimeout(async () => {
    try {
      await cleanupOldRuns();
    } catch (err) {
      console.error('[forge:cleanup] startup failed:', err);
    }
  }, 30_000);
}

async function cleanupOldRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Delete runs older than RETENTION_DAYS.
  const oldRuns = await db.run.findMany({
    where: {
      startedAt: { lt: cutoff },
      status: { in: ['success', 'failed', 'canceled'] },
    },
    select: { id: true },
  });

  if (oldRuns.length > 0) {
    const runIds = oldRuns.map((r) => r.id);

    // Delete related data first (cascade).
    await db.logLine.deleteMany({ where: { runId: { in: runIds } } });
    await db.artifact.deleteMany({ where: { runId: { in: runIds } } });
    await db.testReport.deleteMany({ where: { runId: { in: runIds } } });
    await db.runSummary.deleteMany({ where: { runId: { in: runIds } } });
    await db.approval.deleteMany({ where: { runId: { in: runIds } } });
    await db.run.deleteMany({ where: { id: { in: runIds } } });

    console.log(`[forge:cleanup] deleted ${oldRuns.length} old runs (>${RETENTION_DAYS}d)`);
  }

  // Also enforce max runs per project (keep most recent).
  const projects = await db.project.findMany({ select: { id: true } });
  for (const project of projects) {
    const count = await db.run.count({ where: { projectId: project.id } });
    if (count > MAX_RUNS_PER_PROJECT) {
      const excess = count - MAX_RUNS_PER_PROJECT;
      const oldProjectRuns = await db.run.findMany({
        where: { projectId: project.id },
        orderBy: { startedAt: 'asc' },
        take: excess,
        select: { id: true },
      });
      const excessIds = oldProjectRuns.map((r) => r.id);
      await db.logLine.deleteMany({ where: { runId: { in: excessIds } } });
      await db.artifact.deleteMany({ where: { runId: { in: excessIds } } });
      await db.testReport.deleteMany({ where: { runId: { in: excessIds } } });
      await db.runSummary.deleteMany({ where: { runId: { in: excessIds } } });
      await db.approval.deleteMany({ where: { runId: { in: excessIds } } });
      await db.run.deleteMany({ where: { id: { in: excessIds } } });
      console.log(`[forge:cleanup] deleted ${excess} excess runs from project ${project.id}`);
    }
  }
}

// Start automatically.
startLogRotation();
