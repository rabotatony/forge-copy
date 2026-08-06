// TEMPORARY POST probe — does findUnique break on POST / large bodies?
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOVA = "cmsh091gg0000tb1nwnohpcmj";

export async function POST(request: NextRequest): Promise<Response> {
  const out: Record<string, unknown> = {};
  try {
    const ct = request.headers.get("content-type") ?? "";
    const len = request.headers.get("content-length") ?? "?";
    out.contentType = ct;
    out.contentLength = len;
  } catch {}
  try {
    const p = await db.project.findUnique({ where: { id: NOVA } });
    out.findUnique = p ? `FOUND(${p.name})` : "NULL";
  } catch (e) { out.findUnique = `ERR ${e instanceof Error ? e.message.slice(0, 120) : e}`; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    const DB = (ctx.env as Record<string, unknown>).DB as
      | { prepare: (s: string) => { all: () => Promise<{ results?: Array<{ n: number }> }> } }
      | undefined;
    if (DB) {
      const res = await DB.prepare("SELECT COUNT(*) AS n FROM Project").all();
      out.directD1 = res?.results ?? res;
    } else {
      out.directD1 = "NO DB";
    }
  } catch (e) { out.directD1 = `ERR ${e instanceof Error ? e.message.slice(0, 120) : e}`; }
  // NOTE: we deliberately do NOT read request.body here unless asked via ?read=1
  if (new URL(request.url).searchParams.get("read") === "1") {
    try {
      const buf = await request.arrayBuffer();
      out.bodyBytes = buf.byteLength;
    } catch (e) { out.bodyBytes = `ERR ${e instanceof Error ? e.message.slice(0, 120) : e}`; }
  }
  return Response.json(out);
}
