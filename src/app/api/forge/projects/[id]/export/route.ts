// ============================================================
// Forge — Export project as ZIP
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const root = project.extractedPath;
    const projectName = project.name.replace(/[^a-zA-Z0-9-_]/g, "_") || "project";
    const tmpZip = path.join(os.tmpdir(), `forge-export-${id}-${Date.now()}.zip`);

    // Create a list of files to zip (excluding heavy dirs)
    // Use find + zip for reliability
    await new Promise<void>((resolve, reject) => {
      const child = spawn("bash", [
        "-c",
        `cd "${root}" && find . -type f -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.git/*" -not -name "*.db" -not -name ".forge-*" | zip -q "${tmpZip}" -@`
      ]);
      child.on("close", (code) => {
        if (code === 0 || code === 12) resolve(); // 12 = "nothing to do" is OK
        else reject(new Error(`zip exited ${code}`));
      });
      child.on("error", reject);
      // Set a timeout to prevent hanging
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error("zip timed out"));
      }, 30_000);
    });

    if (!fs.existsSync(tmpZip)) {
      return Response.json({ error: "Export failed — no files to zip" }, { status: 500 });
    }

    const zipBuffer = fs.readFileSync(tmpZip);
    try { fs.unlinkSync(tmpZip); } catch {}

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${projectName}.zip"`,
        "Content-Length": String(zipBuffer.length),
      },
    });
  } catch (e) {
    console.error("[export] failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
