import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const token = await db.apiToken.findUnique({ where: { id } });
    if (!token) return Response.json({ error: "Token not found" }, { status: 404 });
    await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
