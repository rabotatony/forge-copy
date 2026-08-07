// ============================================================
// Forge — background job queue (long tasks beyond client timeouts)
// ============================================================
// POST /api/forge/jobs  { cmd }  -> { id }   (spawns detached on real compute)
// GET  /api/forge/jobs?id=...    -> { status, stdout, stderr }
// On edge (no child_process) returns an honest 501.
// ============================================================
import type { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import * as fs from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DIR = "/data/forge-jobs";
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

export async function POST(req: NextRequest): Promise<Response> {
  let cmd = "";
  try { cmd = String((await req.json()).cmd ?? ""); } catch {}
  if (!cmd) return Response.json({ error: "cmd required" }, { status: 400 });
  try {
    const id = Math.random().toString(36).slice(2, 10);
    const out = `${DIR}/${id}.out`; const err = `${DIR}/${id}.err`; const st = `${DIR}/${id}.status`;
    fs.writeFileSync(st, "running");
    const child = spawn("sh", ["-c", cmd], { detached: true, stdio: ["ignore",
      fs.openSync(out, "w"), fs.openSync(err, "w")] });
    child.on("exit", (code) => { try { fs.writeFileSync(st, code === 0 ? "done" : `failed:${code}`); } catch {} });
    child.unref();
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: "jobs require real compute: " + String(e) }, { status: 501 });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || /[^a-z0-9]/i.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const read = (f: string) => { try { return fs.readFileSync(`${DIR}/${f}`, "utf8"); } catch { return ""; } };
  const status = read(`${id}.status`) || "unknown";
  return Response.json({ id, status, stdout: read(`${id}.out`).slice(-20000), stderr: read(`${id}.err`).slice(-20000) });
}
