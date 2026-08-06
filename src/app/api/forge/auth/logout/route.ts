// ============================================================
// Forge — logout: clears the forge_session cookie
// ============================================================
// POST /api/forge/auth/logout
// ============================================================
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const res = Response.json({ ok: true });
  res.cookies.set("forge_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
