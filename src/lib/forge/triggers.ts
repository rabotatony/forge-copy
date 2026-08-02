// ============================================================
// Forge — triggers (Phase 3): webhooks + cron + scheduler
// ============================================================
// Webhook triggers fire a run (or pipeline) when an HTTP POST hits
//   /api/forge/triggers/<slug>.  Optional HMAC-SHA256 verification.
// Cron triggers fire on a schedule.  A module-level scheduler polls
//   every 60 seconds and dispatches due triggers.
// ============================================================

import * as crypto from 'node:crypto';
import { db } from '@/lib/db';
import type { Trigger, WebhookDelivery } from '@prisma/client';
import { startRunExtended } from './engine';

// ---------------------------------------------------------------------------
// Webhook triggers
// ---------------------------------------------------------------------------

/**
 * Create a webhook trigger for a project/workflow.  Returns the slug and the
 * (relative) URL the caller should POST to.
 *
 * If `secret` is provided, it is stored plaintext — this is the HMAC
 * verification secret, NOT a project secret (those use AES at rest).
 */
export async function createWebhookTrigger(
  projectId: string,
  workflow: string,
  options?: { secret?: string; pipelineId?: string },
): Promise<{ id: string; slug: string; url: string }> {
  const slug = crypto.randomBytes(8).toString('hex'); // 16 hex chars
  const trigger = await db.trigger.create({
    data: {
      projectId,
      type: 'webhook',
      config: slug,
      workflow,
      pipelineId: options?.pipelineId ?? null,
      secret: options?.secret ?? null,
      enabled: true,
    },
  });
  return { id: trigger.id, slug, url: `/api/forge/triggers/${slug}` };
}

/**
 * Verify an HMAC-SHA256 webhook signature.  The signature may be in either
 * `sha256=<hex>` or bare `<hex>` form.  Comparison is constant-time.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  const payloadBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const expected = crypto.createHmac('sha256', secret).update(payloadBuf).digest('hex');
  const sig = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
  const expectedBuf = Buffer.from(expected, 'hex');
  const sigBuf = Buffer.from(sig, 'hex');
  // If the signature isn't valid hex or is the wrong length, reject.
  if (expectedBuf.length !== sigBuf.length || sigBuf.length === 0) return false;
  try {
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Fire a webhook trigger identified by its slug.  Verifies the HMAC signature
 * (if a secret is configured), records a WebhookDelivery row, and either
 * starts a single run (via startRunExtended) or starts a pipeline (if the
 * trigger has a pipelineId).  Always returns a status object — never throws.
 */
export async function fireWebhookTrigger(
  slug: string,
  payload: { method: string; headers: string; body: string },
): Promise<{ runId: string | null; status: string; error?: string }> {
  const trigger = await db.trigger.findFirst({
    where: { type: 'webhook', config: slug },
  });
  if (!trigger) {
    return { runId: null, status: 'rejected', error: 'trigger not found' };
  }

  // Verify HMAC if a secret is configured.
  if (trigger.secret) {
    let sig: string | null = null;
    try {
      const headers = JSON.parse(payload.headers) as Record<string, string>;
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'x-forge-signature') {
          sig = v;
          break;
        }
      }
    } catch {
      /* headers not JSON — leave sig null */
    }

    if (!sig || !verifyWebhookSignature(payload.body, sig, trigger.secret)) {
      await db.webhookDelivery.create({
        data: {
          triggerId: trigger.id,
          method: payload.method,
          headers: payload.headers,
          body: payload.body,
          runId: null,
          status: 'rejected',
          error: 'signature mismatch',
        },
      });
      await db.trigger.update({
        where: { id: trigger.id },
        data: { lastFiredAt: new Date() },
      });
      return { runId: null, status: 'rejected', error: 'signature mismatch' };
    }
  }

  // Fire the trigger.
  let runId: string | null = null;
  let status = 'accepted';
  let error: string | undefined;

  try {
    if (trigger.pipelineId) {
      // Lazily import the pipeline module (built by a separate agent).
      const result = await tryStartPipeline(trigger.pipelineId, 'webhook');
      runId = result;
      if (result === null) {
        status = 'error';
        error = 'pipeline module unavailable or pipeline start failed';
      }
    } else {
      const result = await startRunExtended({
        projectId: trigger.projectId,
        workflow: trigger.workflow,
        trigger: 'webhook',
      });
      runId = result.runId;
    }
  } catch (err) {
    status = 'error';
    error = err instanceof Error ? err.message : String(err);
  }

  // Record delivery.
  await db.webhookDelivery.create({
    data: {
      triggerId: trigger.id,
      method: payload.method,
      headers: payload.headers,
      body: payload.body,
      runId,
      status,
      error,
    },
  });

  // Update lastFiredAt.
  await db.trigger.update({
    where: { id: trigger.id },
    data: { lastFiredAt: new Date() },
  });

  return { runId, status, error };
}

// ---------------------------------------------------------------------------
// Cron triggers
// ---------------------------------------------------------------------------

const CRON_RANGES: Array<[number, number]> = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day-of-month
  [1, 12],  // month
  [0, 7],   // day-of-week (0 and 7 = Sunday)
];

/**
 * Create a cron trigger.  Validates the cron expression (5 fields, each
 * matching `*`, star-slash-N, `N`, `N-M`, or comma-separated lists of those).
 */
export async function createCronTrigger(
  projectId: string,
  workflow: string,
  cronExpression: string,
  options?: { pipelineId?: string },
): Promise<{ id: string }> {
  if (!validateCronExpression(cronExpression)) {
    throw new Error(`Invalid cron expression: "${cronExpression}"`);
  }
  const trigger = await db.trigger.create({
    data: {
      projectId,
      type: 'cron',
      config: cronExpression,
      workflow,
      pipelineId: options?.pipelineId ?? null,
      enabled: true,
    },
  });
  return { id: trigger.id };
}

/** Validate a 5-field cron expression. */
export function validateCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  for (let i = 0; i < 5; i++) {
    const [min, max] = CRON_RANGES[i]!;
    if (!validateCronField(parts[i]!, min, max)) return false;
  }
  return true;
}

function validateCronField(field: string, min: number, max: number): boolean {
  if (field.length === 0) return false;
  for (const part of field.split(',')) {
    if (part === '*') continue;
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^\*\/(\d+)$/))) {
      const n = parseInt(m[1]!, 10);
      if (n < 1 || n > max) return false;
    } else if ((m = part.match(/^(\d+)-(\d+)$/))) {
      const lo = parseInt(m[1]!, 10);
      const hi = parseInt(m[2]!, 10);
      if (lo < min || hi > max || lo > hi) return false;
    } else if ((m = part.match(/^(\d+)$/))) {
      const n = parseInt(m[1]!, 10);
      if (n < min || n > max) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** Returns true if the cron expression should fire at the given date/time. */
export function isCronDue(cronExpression: string, date: Date): boolean {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minuteField, hourField, dayField, monthField, weekdayField] = parts;

  const minutes = parseCronField(minuteField!, 0, 59);
  const hours = parseCronField(hourField!, 0, 23);
  const days = parseCronField(dayField!, 1, 31);
  const months = parseCronField(monthField!, 1, 12);
  const weekdays = parseCronField(weekdayField!, 0, 7);
  // Normalise weekday 7 -> 0 (both = Sunday in cron).
  if (weekdays.has(7)) {
    weekdays.delete(7);
    weekdays.add(0);
  }

  if (!minutes.has(date.getMinutes())) return false;
  if (!hours.has(date.getHours())) return false;
  if (!months.has(date.getMonth() + 1)) return false;

  // Standard cron OR rule: if BOTH day-of-month and day-of-week are restricted
  // (neither is `*`), match if either matches.  Otherwise both must match.
  const dayRestricted = !dayField!.includes('*');
  const weekdayRestricted = !weekdayField!.includes('*');
  const dayMatch = days.has(date.getDate());
  const weekdayMatch = weekdays.has(date.getDay());
  if (dayRestricted && weekdayRestricted) {
    if (!dayMatch && !weekdayMatch) return false;
  } else {
    if (!dayMatch || !weekdayMatch) return false;
  }
  return true;
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of field.split(',')) {
    let m: RegExpMatchArray | null;
    if (part === '*') {
      for (let i = min; i <= max; i++) result.add(i);
    } else if ((m = part.match(/^\*\/(\d+)$/))) {
      const step = parseInt(m[1]!, 10);
      for (let i = min; i <= max; i += step) result.add(i);
    } else if ((m = part.match(/^(\d+)-(\d+)$/))) {
      const lo = parseInt(m[1]!, 10);
      const hi = parseInt(m[2]!, 10);
      for (let i = lo; i <= hi; i++) result.add(i);
    } else if ((m = part.match(/^(\d+)$/))) {
      result.add(parseInt(m[1]!, 10));
    }
    // Unknown patterns are silently dropped (validateCronField handles rejection).
  }
  return result;
}

// ---------------------------------------------------------------------------
// Listing & deletion
// ---------------------------------------------------------------------------

/** List all triggers for a project, with recent webhook deliveries attached. */
export async function listTriggers(
  projectId: string,
): Promise<Array<Trigger & { deliveries: WebhookDelivery[] }>> {
  const triggers = await db.trigger.findMany({
    where: { projectId },
    include: {
      deliveries: { orderBy: { receivedAt: 'desc' }, take: 20 },
    },
    orderBy: { createdAt: 'desc' },
  });
  return triggers as Array<Trigger & { deliveries: WebhookDelivery[] }>;
}

/** Delete a trigger (must belong to the given project). */
export async function deleteTrigger(projectId: string, triggerId: string): Promise<void> {
  const trigger = await db.trigger.findFirst({ where: { id: triggerId, projectId } });
  if (!trigger) throw new Error('Trigger not found');
  await db.trigger.delete({ where: { id: triggerId } });
}

/** List webhook deliveries for a trigger (most recent first). */
export async function listWebhookDeliveries(
  triggerId: string,
  limit = 50,
): Promise<WebhookDelivery[]> {
  return db.webhookDelivery.findMany({
    where: { triggerId },
    orderBy: { receivedAt: 'desc' },
    take: limit,
  });
}

/** All enabled cron triggers across all projects (used by the scheduler). */
export async function getCronTriggers(): Promise<Trigger[]> {
  return db.trigger.findMany({ where: { type: 'cron', enabled: true } });
}

// ---------------------------------------------------------------------------
// Cron scheduler
// ---------------------------------------------------------------------------

let cronSchedulerStarted = false;

/**
 * Start the background cron scheduler (60-second tick).  Guarded by a
 * module-level boolean so it only starts once per process.
 */
let cronTickInFlight = false;

export function startCronScheduler(): void {
  if (cronSchedulerStarted) return;
  cronSchedulerStarted = true;

  // Tick every 60 seconds.
  setInterval(() => {
    void tickCronScheduler().catch((err) => {
      console.error('[forge:cron] scheduler tick failed:', err);
    });
  }, 60_000);

  // Also tick once shortly after startup to catch any due jobs immediately.
  setTimeout(() => {
    void tickCronScheduler().catch((err) => {
      console.error('[forge:cron] startup tick failed:', err);
    });
  }, 5_000);
}

async function tickCronScheduler() {
  if (cronTickInFlight) return;
  cronTickInFlight = true;
  try { await tickCronSchedulerInner(); } finally { cronTickInFlight = false; }
}

async function tickCronSchedulerInner(): Promise<void> {
  const triggers = await getCronTriggers();
  const now = new Date();
  for (const trigger of triggers) {
    try {
      if (!isCronDue(trigger.config, now)) continue;

      // Skip if already fired within the current minute (prevents duplicate
      // fires when the scheduler ticks faster than 60s or in dev hot-reload).
      if (trigger.lastFiredAt && sameMinute(trigger.lastFiredAt, now)) {
        continue;
      }

      if (trigger.pipelineId) {
        const result = await tryStartPipeline(trigger.pipelineId, 'cron');
        if (result === null) {
          console.error(`[forge:cron] pipeline start failed for trigger ${trigger.id}`);
        }
      } else {
        try {
          await startRunExtended({
            projectId: trigger.projectId,
            workflow: trigger.workflow,
            trigger: 'cron',
          });
        } catch (err) {
          console.error(
            `[forge:cron] run start failed for trigger ${trigger.id}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      await db.trigger.update({
        where: { id: trigger.id },
        data: { lastFiredAt: now },
      });
    } catch (err) {
      console.error(`[forge:cron] error processing trigger ${trigger.id}:`, err);
    }
  }
}

function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

/**
 * Try to start a pipeline run by lazily importing the (separately-built)
 * pipeline module.  Returns the new run id, or null if the module is
 * unavailable or the call fails.  Never throws.
 */
async function tryStartPipeline(
  pipelineId: string,
  trigger: 'webhook' | 'cron',
): Promise<string | null> {
  try {
    // Use a string variable so TypeScript doesn't statically resolve the
    // module (the pipeline module is built by another agent and may not
    // exist yet at compile time).
    const moduleName = './pipeline';
    const mod = (await import(moduleName)) as {
      startPipelineRun?: (
        pipelineId: string,
        options?: { trigger?: string },
      ) => Promise<{ pipelineRunId?: string; id?: string } | null>;
    };
    if (typeof mod.startPipelineRun !== 'function') return null;
    const result = await mod.startPipelineRun(pipelineId, { trigger });
    return result?.pipelineRunId ?? result?.id ?? null;
  } catch (err) {
    console.error('[forge:triggers] pipeline import/start failed:', err);
    return null;
  }
}

// Note: startCronScheduler() is called by bootstrap.ts (ensureBootstrapped).
// Do NOT auto-start here — that would create duplicate schedulers.
