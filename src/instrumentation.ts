// ============================================================
// Forge — Next.js instrumentation hook
// ============================================================
// This file is auto-detected by Next.js and run once on server
// startup. It boots the Forge background timers (log rotation +
// cron scheduler) in the node runtime only.
//
// See: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
// ============================================================
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureBootstrapped } = await import("@/lib/forge/bootstrap");
  ensureBootstrapped();
}
