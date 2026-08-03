// ============================================================
// Forge — Live preview server
// GET /api/forge/projects/[id]/preview/**
// Serves the project's live build output (or workspace for static
// projects) directly from the Forge node — the "live link" opened
// in the browser while editing. SPA/Next static fallback included.
// ============================================================
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { resolvePreviewDir } from "@/lib/forge/live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".apk": "application/vnd.android.package-archive",
};

function serveFile(full: string): Response {
  const ext = path.extname(full).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const data = fs.readFileSync(full);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "no-store",
      "X-Forge-Preview": "live",
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; path?: string[] }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    const resolved = resolvePreviewDir(project);
    if (!resolved) {
      return Response.json(
        { error: "Preview not ready yet — enable live mode and wait for the first build." },
        { status: 404 },
      );
    }
    const { dir } = resolved;
    const dirResolved = path.resolve(dir);

    const segments = params.path ?? [];
    const reqPath = segments.map((s) => decodeURIComponent(s)).join("/");

    const target = path.resolve(dirResolved, reqPath);
    if (target !== dirResolved && !target.startsWith(dirResolved + path.sep)) {
      return Response.json({ error: "Forbidden path" }, { status: 403 });
    }

    if (fs.existsSync(target) && fs.statSync(target).isFile()) return serveFile(target);

    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const idx = path.join(target, "index.html");
      if (fs.existsSync(idx)) return serveFile(idx);
    }

    const asHtml = target + ".html";
    if (fs.existsSync(asHtml) && fs.statSync(asHtml).isFile()) return serveFile(asHtml);

    const rootIdx = path.join(dirResolved, "index.html");
    if (fs.existsSync(rootIdx)) return serveFile(rootIdx);

    return Response.json({ error: "Not found in preview output: /" + reqPath }, { status: 404 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
