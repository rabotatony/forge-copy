// ============================================================
// Forge — notifications (Phase 3)
// ============================================================
// Fire-and-forget HTTP POST notifications when runs reach certain states.
// Configurable per project + event ('started' | 'success' | 'failure' |
// 'always').  All external HTTP calls are wrapped in try/catch and use a
// 10-second timeout — notification failures never bubble up to the caller.
// ============================================================

import { db } from '@/lib/db';
import type { Notification } from '@prisma/client';

const NOTIFICATION_TIMEOUT_MS = 10_000;

interface NotificationPayload {
  event: string;
  project: { id: string; name: string; kind: string };
  run: {
    id: string;
    workflow: string;
    status: string;
    exitCode: number | null;
    durationMs: number | null;
    startedAt: string;
    finishedAt: string | null;
  };
  url: string;
}

/**
 * Fire run-completion notifications for a run.  Maps the run's terminal
 * status to event(s) and POSTs a JSON payload to every matching enabled
 * notification URL.  HTTP calls are fire-and-forget (do not block the run).
 */
export async function notifyRunEvent(runId: string, status: string): Promise<void> {
  try {
    const run = await db.run.findUnique({
      where: { id: runId },
      include: { project: true },
    });
    if (!run || !run.project) return;

    // Map status → event(s).
    const events: string[] = [];
    if (status === 'success') {
      events.push('success', 'always');
    } else if (status === 'failed') {
      events.push('failure', 'always');
    } else if (status === 'canceled') {
      events.push('always');
    } else {
      // Non-terminal or unknown statuses: don't fire completion notifications
      // (the 'started' event is handled separately by notifyRunStarted).
      return;
    }

    const notifications = await db.notification.findMany({
      where: { projectId: run.projectId, enabled: true, event: { in: events } },
    });
    if (notifications.length === 0) return;

    const basePayload: Omit<NotificationPayload, 'event'> = {
      project: { id: run.project.id, name: run.project.name, kind: run.project.kind },
      run: {
        id: run.id,
        workflow: run.workflow,
        status: run.status,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      },
      url: `http://localhost:3000/#run=${run.id}`,
    };

    for (const n of notifications) {
      const payload: NotificationPayload = { ...basePayload, event: n.event };
      // Fire-and-forget — do not await.
      void sendNotification(n, payload);
    }
  } catch (err) {
    console.error('[forge:notifications] notifyRunEvent error:', err);
  }
}

/**
 * Fire 'started' notifications for a freshly-started run.  Called at the
 * beginning of a run (separately from completion notifications).
 */
export async function notifyRunStarted(runId: string): Promise<void> {
  try {
    const run = await db.run.findUnique({
      where: { id: runId },
      include: { project: true },
    });
    if (!run || !run.project) return;

    const notifications = await db.notification.findMany({
      where: { projectId: run.projectId, enabled: true, event: 'started' },
    });
    if (notifications.length === 0) return;

    const basePayload: Omit<NotificationPayload, 'event'> = {
      project: { id: run.project.id, name: run.project.name, kind: run.project.kind },
      run: {
        id: run.id,
        workflow: run.workflow,
        status: run.status,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      },
      url: `http://localhost:3000/#run=${run.id}`,
    };

    for (const n of notifications) {
      const payload: NotificationPayload = { ...basePayload, event: 'started' };
      void sendNotification(n, payload);
    }
  } catch (err) {
    console.error('[forge:notifications] notifyRunStarted error:', err);
  }
}

async function sendNotification(n: Notification, payload: NotificationPayload): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFICATION_TIMEOUT_MS);
  try {
    const res = await fetch(n.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[forge:notifications] ${n.url} responded with HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(
      `[forge:notifications] failed to POST to ${n.url}:`,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createNotification(
  projectId: string,
  event: string,
  url: string,
): Promise<Notification> {
  return db.notification.create({
    data: { projectId, event, url, enabled: true },
  });
}

export async function listNotifications(projectId: string): Promise<Notification[]> {
  return db.notification.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteNotification(projectId: string, notificationId: string): Promise<void> {
  const notif = await db.notification.findFirst({
    where: { id: notificationId, projectId },
  });
  if (!notif) throw new Error('Notification not found');
  await db.notification.delete({ where: { id: notificationId } });
}

export async function toggleNotification(
  projectId: string,
  notificationId: string,
  enabled: boolean,
): Promise<void> {
  const notif = await db.notification.findFirst({
    where: { id: notificationId, projectId },
  });
  if (!notif) throw new Error('Notification not found');
  await db.notification.update({
    where: { id: notificationId },
    data: { enabled },
  });
}
