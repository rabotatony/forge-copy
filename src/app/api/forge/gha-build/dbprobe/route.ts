// TEMPORARY db diagnostic — raw vs model reads (remove after fix verified)
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const out: Record<string, unknown> = {};
  try {
    const raw = await db.$queryRaw`SELECT COUNT(*) AS n FROM Project`;
    out.rawCount = raw;
  } catch (e) { out.rawCount = `ERR ${e instanceof Error ? e.message.slice(0, 200) : e}`; }
  try { out.modelCount = await db.project.count(); }
  catch (e) { out.modelCount = `ERR ${e instanceof Error ? e.message.slice(0, 200) : e}`; }
  try {
    const rows = await db.project.findMany({ take: 3, select: { id: true, name: true } });
    out.modelRows = rows;
  } catch (e) { out.modelRows = `ERR ${e instanceof Error ? e.message.slice(0, 200) : e}`; }
  try {
    const one = await db.project.findFirst({ orderBy: { createdAt: "desc" } });
    out.findFirst = one ? { id: one.id, name: one.name } : null;
  } catch (e) { out.findFirst = `ERR ${e instanceof Error ? e.message.slice(0, 200) : e}`; }
  out.runtime = process.env.FORGE_RUNTIME ?? "unset";
  return Response.json(out);
}
