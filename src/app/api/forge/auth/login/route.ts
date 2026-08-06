// ============================================================
// Forge — login with an API token -> sets HttpOnly session cookie
// ============================================================
// POST /api/forge/auth/login
//   body: { token: "fk_xxx" }   (or Authorization: Bearer fk_xxx)
//   -> 200 { ok, token: {...} } + Set-Cookie: forge_session
// ============================================================
import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/forge/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    let reqToAuth: Request = request;
    try {
      const body = await request.clone().json();
      if (body && typeof body.token === "string" && body.token.trim()) {
        reqToAuth = new Request(request.url, {
          method: "POST",
          headers: { authorization: `Bearer ${body.token.trim()}` },
        });
      }
    } catch {
      /* no body — fall back to header auth */
    }

    const auth = await authenticate(reqToAuth);
    if (!auth.valid || !auth.token) {
      return Response.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });
    }

    let raw: string | null = null;
    const h = reqToAuth.headers.get("authorization");
    if (h) raw = h.replace(/^Bearer\s+/i, "").trim();

    const res = Response.json({ ok: true, token: auth.token });
    if (raw) {
      res.cookies.set("forge_session", raw, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return res;
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
