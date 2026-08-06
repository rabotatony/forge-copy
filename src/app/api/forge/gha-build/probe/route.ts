// TEMPORARY diagnostic v3 — test getCloudflareContext sync/async + full D1 query.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get("id") ?? "testproj_zip1";
  const out: Record<string, string> = {};

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const onc = require("@opennextjs/cloudflare");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaD1 } = require("@prisma/adapter-d1");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require("@prisma/client");

  // --- sync mode ---
  let syncEnv: any = null;
  try {
    const ctx = onc.getCloudflareContext();
    syncEnv = ctx.env;
    out.syncCtx = `ok (DB=${typeof ctx.env?.DB})`;
  } catch (e) { out.syncCtx = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  // --- async mode ---
  let asyncEnv: any = null;
  try {
    const ctx = await onc.getCloudflareContext({ async: true });
    asyncEnv = ctx.env;
    out.asyncCtx = `ok (DB=${typeof ctx.env?.DB})`;
  } catch (e) { out.asyncCtx = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  const env = asyncEnv ?? syncEnv;
  if (env?.DB) {
    try {
      const adapter = new PrismaD1(env.DB);
      const client = new PrismaClient({ adapter });
      const rows = await client.project.findMany({ take: 1 });
      out.findMany = `ok (${rows.length} rows)`;
      const row = await client.project.findUnique({ where: { id } });
      out.findUnique = row ? `ok (${row.name})` : "ok (null)";
    } catch (e) {
      out.query = `ERR ${e instanceof Error ? e.message.slice(0, 250) : e}`;
    }
  } else {
    out.query = "no DB binding available";
  }

  return Response.json(out);
}
