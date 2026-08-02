// ============================================================

import { db } from "@/lib/db";
// Forge — server bootstrap
// ============================================================
// Single entry point for background timers (log rotation, cron
// scheduler). Imported lazily by the engine so that callers that
// only need the type/SSB-bus logic (e.g. tests) don't accidentally
// start timers.
//
// Next.js instrumentation.ts (next.config experimental or root-level
// instrumentation file) calls `register()` once on server startup.
// We also expose `ensureBootstrapped()` for any route handler that
// needs to lazily ensure timers are running.
// ============================================================
import { startLogRotation } from "./cleanup";
import { startCronScheduler } from "./triggers";

let bootstrapped = false;

async function recoverStaleRuns(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const r1 = await db.run.updateMany({ where: { status: { in: ["running", "queued"] }, startedAt: { lt: cutoff } }, data: { status: "failed", exitCode: -1, finishedAt: new Date(), durationMs: 0 } });
    const r2 = await db.run.updateMany({ where: { status: "waiting_approval", startedAt: { lt: cutoff } }, data: { status: "canceled", exitCode: 130, finishedAt: new Date(), durationMs: 0 } });
    if (r1.count + r2.count > 0) console.log(`[forge:bootstrap] recovered ${r1.count + r2.count} stale runs`);
  } catch (e) { console.error("[forge:bootstrap] recoverStaleRuns failed:", e); }
}

export function ensureBootstrapped(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    startLogRotation();
  } catch {
    /* log rotation failures must not crash the server */
  }
  try {
    startCronScheduler();
  } catch {
    /* scheduler failures must not crash the server */
  }
}

/**
 * Next.js instrumentation hook. Called once per server instance.
 *
 * `register()` is invoked in both node and edge runtimes — we only
 * want to start timers on the node runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  ensureBootstrapped();
}
