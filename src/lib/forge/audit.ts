// ============================================================
// Forge — Audit logging helper
// ============================================================
import { db } from "@/lib/db";

export async function audit(
  action: string,
  entityType: string,
  entityId: string,
  actor?: string,
  details?: Record<string, unknown>,
  ip?: string,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        actor: actor ?? "system",
        details: details ? JSON.stringify(details) : null,
        ip: ip ?? null,
      },
    });
  } catch (e) {
    console.error("[forge:audit] failed to log:", action, e);
  }
}
