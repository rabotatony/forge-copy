// ============================================================
// Forge — web terminal (run shell commands on the host)
// ============================================================
import type { NextRequest } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const run = promisify(exec);

export async function POST(req: NextRequest): Promise<Response> {
  let cmd = ""; let cwd: string | undefined;
  try { const b = await req.json(); cmd = String(b.cmd ?? ""); cwd = b.cwd || undefined; } catch {}
  if (!cmd) return Response.json({ error: "cmd required" }, { status: 400 });
  try {
    try {
      const { stdout, stderr } = await run(cmd, { cwd, timeout: 50000, maxBuffer: 8*1024*1024 });
      return Response.json({ ok: true, stdout, stderr });
    } catch (e: any) {
      return Response.json({ ok: false, stdout: e?.stdout ?? "", stderr: e?.stderr ?? "", error: String(e?.message ?? e) });
    }
  } catch {
    return Response.json({ ok: false, error: "This runtime cannot spawn a shell. Run Forge on real compute to enable the terminal." }, { status: 501 });
  }
}
