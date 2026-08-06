// ============================================================
// Forge — session info (who am I right now?)
// ============================================================
// GET /api/forge/auth/session
//   Uses Authorization header OR forge_session cookie.
//   -> 200 { authenticated, token } | 401 { authenticated: false }
// ============================================================
import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/forge/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.valid || !auth.token) {
      return Response.json({ authenticated: false, error: auth.error ?? "Unauthorized" }, { status: 401 });
    }
    return Response.json({ authenticated: true, token: auth.token });
  } catch (e) {
    return Response.json({ authenticated: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
