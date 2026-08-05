// ============================================================
// Forge — build report callback from the GitHub runner
// ============================================================
// POST /api/forge/gha-build/callback
// The forge-remote-build workflow POSTs here when a build finishes:
//   { runId, status, runUrl }  + header x-forge-token
// Recorded into AuditLog for the UI/history. If
// FORGE_GHA_CALLBACK_TOKEN is set, the header must match.
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/forge/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = request.headers.get("x-forge-token") ?? "";
    const expected = process.env.FORGE_GHA_CALLBACK_TOKEN;
    if (expected && token !== expected) return fail("bad callback token", 401);

    const runId = typeof body.runId === "string" ? body.runId : null;
    try {
      await db.auditLog.create({
        data: {
          action: "gha.build.report",
          entityType: "run",
          entityId: runId,
          actor: "github-actions",
          details: JSON.stringify(body),
        },
      });
    } catch {
      // audit persistence is best-effort
    }
    return ok({ received: true });
  } catch {
    return ok({ received: true });
  }
}
