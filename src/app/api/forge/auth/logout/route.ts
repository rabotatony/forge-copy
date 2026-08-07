// ============================================================
// Forge — logout: clears the forge_session cookie
// ============================================================
// POST /api/forge/auth/logout
// ============================================================
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("forge_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
