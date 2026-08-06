// TEMPORARY diagnostic v2 — pinpoints which D1-adapter step fails on Workers.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get("id") ?? "testproj_zip1";
  const out: Record<string, string> = {};

  // 1. require adapter-d1
  let PrismaD1: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@prisma/adapter-d1");
    PrismaD1 = mod.PrismaD1;
    out.adapterRequire = `ok (PrismaD1=${typeof PrismaD1}, keys=${Object.keys(mod).slice(0, 6).join("|")})`;
  } catch (e) { out.adapterRequire = `ERR ${e instanceof Error ? e.message : e}`; }

  // 2. require @opennextjs/cloudflare
  let getRequestContext: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@opennextjs/cloudflare");
    getRequestContext = mod.getRequestContext;
    out.opennextRequire = `ok (getRequestContext=${typeof getRequestContext}, keys=${Object.keys(mod).slice(0, 8).join("|")})`;
  } catch (e) { out.opennextRequire = `ERR ${e instanceof Error ? e.message : e}`; }

  // 3. request context + DB binding
  let DB: any = null;
  if (getRequestContext) {
    try {
      const ctx = getRequestContext();
      DB = (ctx.env as Record<string, unknown>).DB;
      out.reqContext = `ok (DB=${typeof DB})`;
    } catch (e) { out.reqContext = `ERR ${e instanceof Error ? e.message : e}`; }
  }

  // 4. construct adapter
  let adapter: any = null;
  if (PrismaD1 && DB) {
    try {
      adapter = new PrismaD1(DB);
      out.adapterNew = "ok";
    } catch (e) { out.adapterNew = `ERR ${e instanceof Error ? e.message : e}`; }
  }

  // 5. PrismaClient with adapter
  if (adapter) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaClient } = require("@prisma/client");
      const client = new PrismaClient({ adapter });
      out.clientNew = "ok";
      // 6. model query
      try {
        const rows = await client.project.findMany({ take: 1 });
        out.findMany = `ok (${rows.length} rows)`;
      } catch (e) { out.findMany = `ERR ${e instanceof Error ? e.message.slice(0, 180) : e}`; }
      try {
        const row = await client.project.findUnique({ where: { id } });
        out.findUnique = row ? `ok (${row.name})` : "ok (null)";
      } catch (e) { out.findUnique = `ERR ${e instanceof Error ? e.message.slice(0, 180) : e}`; }
    } catch (e) { out.clientNew = `ERR ${e instanceof Error ? e.message.slice(0, 180) : e}`; }
  }

  return Response.json(out);
}
