// ============================================================
// Forge — token verification endpoint
// ============================================================
// GET /api/forge/auth/verify
//   Authorization: Bearer fk_xxx (or forge_session cookie)
//   -> 200 { valid, id, name, scopes, projectId } | 401 { valid: false }
//
// Used internally by the middleware for edge-safe validation,
// and externally by API clients to test a token.
// ============================================================
import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/forge/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.valid || !auth.token) {
      return Response.json({ valid: false, error: auth.error ?? "Unauthorized" }, { status: 401 });
    }
    return Response.json({
      valid: true,
      id: auth.token.id,
      name: auth.token.name,
      scopes: auth.token.scopes,
      projectId: auth.token.projectId,
    });
  } catch (e) {
    return Response.json({ valid: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
