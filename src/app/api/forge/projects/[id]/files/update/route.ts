import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import * as fs from "node:fs";
import * as path from "node:path";
import { getLiveState, scheduleLiveBuild } from "@/lib/forge/live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const body = await req.json();
    const files = body.files as Record<string, string>;
    if (!files) return Response.json({ error: "files object is required" }, { status: 400 });
    const root = project.extractedPath;
    let updated = 0, created = 0;
    for (const [relPath, content] of Object.entries(files)) {
      try {
        const full = path.resolve(root, relPath);
        if (full !== root && !full.startsWith(root + path.sep)) continue;
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const existed = fs.existsSync(full);
        fs.writeFileSync(full, content);
        if (existed) updated++; else created++;
      } catch {}
    }

    // Live mode: debounce-rebuild after saves so the preview link
    // reflects the latest edit within ~2 seconds.
    let liveScheduled = false;
    try {
      if (updated + created > 0 && getLiveState(id).enabled) {
        scheduleLiveBuild(id);
        liveScheduled = true;
      }
    } catch {}

    return Response.json({ ok: true, updated, created, liveScheduled });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
