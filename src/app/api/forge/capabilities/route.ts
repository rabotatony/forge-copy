// ============================================================
// Forge — runtime capabilities matrix (honest self-report)
// ============================================================
// GET /api/forge/capabilities
// Reports what THIS runtime can actually do: fs, child_process,
// available language runtimes, and whether builds can run locally.
// ============================================================
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

async function has(mod: string): Promise<boolean> {
  try { await import(mod); return true; } catch { return false; }
}

async function which(bin: string): Promise<boolean> {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(exec)(`command -v ${bin}`, { timeout: 5000 });
    return true;
  } catch { return false; }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const fs = await has("node:fs");
  const child = await has("node:child_process");

  let runtimes: Record<string, boolean> = {};
  if (child) {
    for (const b of ["node","bun","python3","python","go","cargo","rustc","java","gcc","docker"]) {
      runtimes[b] = await which(b);
    }
  }

  return Response.json({
    runtime: typeof process !== "undefined" ? (process as any).env?.FORGE_RUNTIME || "nodejs" : "edge",
    filesystem: fs,
    childProcess: child,
    localBuilds: fs && child,
    runtimes,
    note: fs && child
      ? "Full sovereign compute: builds and any environment run locally."
      : "Edge runtime: heavy builds require a real-compute node (VPS/Sealos).",
  });
}
