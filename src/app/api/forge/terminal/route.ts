// ============================================================
// Forge — web terminal (run shell commands on the host)
// ============================================================
// POST /api/forge/terminal  { cmd, cwd? }
// Executes a shell command via child_process on real compute.
// On edge runtimes (no child_process) returns a clear notice.
// ============================================================
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<Response> {
  let cmd = ""; let cwd: string | undefined;
  try { const b = await req.json(); cmd = String(b.cmd ?? ""); cwd = b.cwd || undefined; } catch {}
  if (!cmd) return Response.json({ error: "cmd required" }, { status: 400 });

  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(exec);
    try {
      const { stdout, stderr } = await run(cmd, { cwd, timeout: 50000, maxBuffer: 8*1024*1024 });
      return Response.json({ ok: true, stdout, stderr });
    } catch (e: any) {
      return Response.json({ ok: false, stdout: e?.stdout ?? "", stderr: e?.stderr ?? String(e), error: String(e?.message ?? e) });
    }
  } catch {
    return Response.json({
      ok: false,
      error: "This runtime (edge) cannot spawn a shell. Run Forge on real compute (VPS/Sealos) to enable the terminal.",
    }, { status: 501 });
  }
}
