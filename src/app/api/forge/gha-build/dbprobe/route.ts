// TEMPORARY db diagnostic v4 — findUnique vs findFirst vs raw, with SQL capture
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const out: Record<string, unknown> = {};
  try {
    const raw = await db.$queryRaw`SELECT id, name, fileCount FROM Project ORDER BY createdAt DESC LIMIT 5`;
    out.rawProjects = raw;
  } catch (e) { out.rawProjects = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  const novaId = "cmsh091gg0000tb1nwnohpcmj";
  const tinyId = "cmsgztzp30000nq1nhsyn87fo";

  try { out.findUnique_nova = await db.project.findUnique({ where: { id: novaId } }) ? "FOUND" : "NULL"; }
  catch (e) { out.findUnique_nova = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  try { out.findFirst_nova = await db.project.findFirst({ where: { id: novaId } }) ? "FOUND" : "NULL"; }
  catch (e) { out.findFirst_nova = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  try { out.findUnique_tiny = await db.project.findUnique({ where: { id: tinyId } }) ? "FOUND" : "NULL"; }
  catch (e) { out.findUnique_tiny = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  try {
    const like = await db.project.findFirst({ where: { name: { contains: "Nova" } } });
    out.findFirst_nameNova = like ? { id: like.id, name: like.name } : "NULL";
  } catch (e) { out.findFirst_nameNova = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  try { out.count = await db.project.count(); }
  catch (e) { out.count = `ERR ${e instanceof Error ? e.message.slice(0, 150) : e}`; }

  return Response.json(out);
}
