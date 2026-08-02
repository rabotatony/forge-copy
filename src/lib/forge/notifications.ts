// ============================================================
// Forge — notifications (Phase 3)
// ============================================================
// Fire-and-forget HTTP POST notifications when runs reach certain states.
// Configurable per project + event ('started' | 'success' | 'failure' |
// 'always').  All external HTTP calls are wrapped in try/catch and use a
// 10-second timeout — notification failures never bubble up to the caller.
//
// As of R-4, the two near-duplicate functions `notifyRunEvent` and
// `notifyRunStarted` have been merged into a single `notify(runId, event)`
// entry point. The old names are preserved as thin wrappers for backwards
// compatibility — see the bottom of this file.
// ============================================================

import { db } from '@/lib/db';
import type { Notification } from '@prisma/client';

const NOTIFICATION_TIMEOUT_MS = 10_000;

/** Base URL for run links in notification payloads. */
const FORGE_BASE_URL = process.env.FORGE_BASE_URL ?? 'http://localhost:3000';

/** Event kinds a notification subscription can match. */
export type NotificationEvent = 'started' | 'success' | 'failure' | 'always';

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
 * Map a single logical event (or legacy RunStatus string) to the set of
 * notification subscriptions that should fire.
 *
 *   • 'started'   → ['started']
 *   • 'success'   → ['success', 'always']
 *   • 'failure'   → ['failure', 'always']
 *   • 'always'    → ['always']
 *   • 'canceled'  → ['always']         (legacy RunStatus — same as 'always')
 *   • 'failed'    → ['failure', 'always']  (legacy RunStatus — alias for 'failure')
 *   • anything else (running / queued / waiting_approval / unknown) → []
 *
 * The empty-array cases cause `notify()` to short-circuit — non-terminal
 * statuses should never fire completion notifications.
 */
function eventsForEvent(event: string): string[] {
  switch (event) {
    case 'started':
      return ['started'];
    case 'success':
      return ['success', 'always'];
    case 'failure':
    case 'failed':
      return ['failure', 'always'];
    case 'always':
      return ['always'];
    case 'canceled':
      return ['always'];
    default:
      // Non-terminal or unknown status: don't fire completion notifications.
      return [];
  }
}

/**
 * Fire run notifications for a run + event combination.
 *
 * Fetches the run (with its project), maps the event to the matching
 * subscription `event` values (see `eventsForEvent`), and POSTs a JSON
 * payload to every enabled matching notification URL. HTTP calls are
 * fire-and-forget (do not block the run).
 */
export async function notify(
  runId: string,
  event: NotificationEvent,
): Promise<void> {
  try {
    const events = eventsForEvent(event);
    if (events.length === 0) return;

    const run = await db.run.findUnique({
      where: { id: runId },
      include: { project: true },
    });
    if (!run || !run.project) return;

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
      url: `${FORGE_BASE_URL}/#run=${run.id}`,
    };

    for (const n of notifications) {
      const payload: NotificationPayload = { ...basePayload, event: n.event };
      // Fire-and-forget — do not await.
      void sendNotification(n, payload);
    }
  } catch (err) {
    console.error('[forge:notifications] notify error:', err);
  }
}

/**
 * Backwards-compat wrapper: notify(runId, status) where status is the
 * run's terminal status string ("success" | "failed" | "canceled" | …).
 * `notify()` accepts the same string and normalizes it via
 * `eventsForEvent`. Kept so existing callers (`engine.ts:finishRun`,
 * `pipeline.ts:finishPipelineRun`) don't need to change.
 */
export const notifyRunEvent = (runId: string, status: string): Promise<void> =>
  notify(runId, status as NotificationEvent);

/**
 * Backwards-compat wrapper: fire the 'started' notification for a
 * freshly-started run.
 */
export const notifyRunStarted = (runId: string): Promise<void> =>
  notify(runId, 'started');

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

// SSRF defense: validate webhook URL before sending.
export function validateWebhookUrl(rawUrl: string): string | null {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return "Invalid URL"; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `Scheme not allowed`;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "metadata" || host.endsWith(".internal") || host.endsWith(".local")) return `Internal hostname`;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) { const [a, b] = [parseInt(v4[1]), parseInt(v4[2])]; if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) return `Private/loopback IP`; }
  return null;
}
