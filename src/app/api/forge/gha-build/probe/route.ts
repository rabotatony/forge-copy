// TEMPORARY diagnostic — isolates which primitive fails on Workers.
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import * as nodeCrypto from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get("id") ?? "testproj_zip1";
  const out: Record<string, string> = {};

  try {
    const rows = await db.project.findMany({ take: 1 });
    out.findMany = `ok (${rows.length})`;
  } catch (e) { out.findMany = `ERR ${e instanceof Error ? e.message : e}`; }

  try {
    const row = await db.project.findUnique({ where: { id } });
    out.findUnique = row ? `ok (${row.name})` : "ok (null)";
  } catch (e) { out.findUnique = `ERR ${e instanceof Error ? e.message : e}`; }

  try {
    const h = nodeCrypto.createHmac("sha256", "k").update(id).digest("hex");
    out.nodeCryptoHmac = `ok ${h.slice(0, 12)}`;
  } catch (e) { out.nodeCryptoHmac = `ERR ${e instanceof Error ? e.message : e}`; }

  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode("k"),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
    out.webCryptoHmac = `ok ${sig.byteLength}b`;
  } catch (e) { out.webCryptoHmac = `ERR ${e instanceof Error ? e.message : e}`; }

  try {
    out.origin = new URL(request.url).origin;
  } catch (e) { out.origin = `ERR ${e instanceof Error ? e.message : e}`; }

  return Response.json(out);
}
