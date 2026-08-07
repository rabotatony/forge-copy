// ============================================================
// Forge — runtime capabilities matrix (honest self-report)
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const run = promisify(exec);
async function which(bin: string): Promise<boolean> {
  try { await run(`command -v ${bin}`, { timeout: 5000 }); return true; } catch { return false; }
}

export async function GET(_req: NextRequest): Promise<Response> {
  let filesystem = false;
  try { filesystem = fs.existsSync("/"); } catch { filesystem = false; }
  let child = false;
  try { await run("true", { timeout: 5000 }); child = true; } catch { child = false; }

  let runtimes: Record<string, boolean> = {};
  if (child) {
    for (const b of ["node","bun","python3","python","go","cargo","rustc","java","gcc","docker"]) {
      runtimes[b] = await which(b);
    }
  }
  return Response.json({
    runtime: "nodejs",
    filesystem, childProcess: child, localBuilds: filesystem && child,
    runtimes,
    note: filesystem && child
      ? "Full sovereign compute: builds and any environment run locally."
      : "Edge runtime: heavy builds require a real-compute node (VPS/Sealos).",
  });
}
