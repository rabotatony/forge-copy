// TEMPORARY POST probe v2 — full files-route module graph + colo info
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
// same imports as the files route:
import { writeStorageFile } from "@/lib/forge/storage-io";
import { extractDir } from "@/lib/forge/storage";
import { verifySourceToken } from "@/lib/forge/gha-build";
import { detectFromManifest } from "@/lib/forge/project-detect";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOVA = "cmsh091gg0000tb1nwnohpcmj";

export async function POST(request: NextRequest): Promise<Response> {
  const out: Record<string, unknown> = {};

  // 0. location info
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    const cf = (ctx as { cf?: { colo?: string; city?: string } }).cf;
    out.colo = cf?.colo ?? "?";
    out.city = cf?.city ?? "?";
  } catch (e) { out.colo = `ERR ${e instanceof Error ? e.message.slice(0, 80) : e}`; }

  // 1. exercise the files-route graph (token verify with garbage -> null expected)
  try {
    const v = await verifySourceToken("garbage.token");
    out.verifyGarbage = v === null ? "null (ok)" : `UNEXPECTED ${v}`;
  } catch (e) { out.verifyGarbage = `ERR ${e instanceof Error ? e.message.slice(0, 100) : e}`; }
  out.graphRefs = [typeof writeStorageFile, typeof extractDir, typeof detectFromManifest, path.posix.join("a", "b")];

  // 2. the critical reads
  try {
    const p = await db.project.findUnique({ where: { id: NOVA } });
    out.findUnique = p ? `FOUND(${p.name})` : "NULL";
  } catch (e) { out.findUnique = `ERR ${e instanceof Error ? e.message.slice(0, 120) : e}`; }
  try {
    const raw = await db.$queryRaw`SELECT COUNT(*) AS n FROM Project`;
    out.rawCount = raw;
  } catch (e) { out.rawCount = `ERR ${e instanceof Error ? e.message.slice(0, 120) : e}`; }
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

  return Response.json(out);
}
