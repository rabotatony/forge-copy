// ============================================================
// Forge Sites — serve deployed files at a unique URL
// ============================================================
import type { NextRequest } from "next/server";
import { readStorageFile } from "@/lib/forge/storage-io";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript", mjs: "text/javascript",
  css: "text/css", json: "application/json", png: "image/png", jpg: "image/jpeg",
  svg: "image/svg+xml", ico: "image/x-icon", txt: "text/plain", woff2: "font/woff2",
};

export async function GET(_req: NextRequest, ctx: any): Promise<Response> {
  const params = await ctx.params;
  const siteId = String(params.siteId ?? "");
  let path = Array.isArray(params.path) ? params.path.join("/") : String(params.path ?? "");
  if (!path) path = "index.html";
  const data = await readStorageFile(`sites/${siteId}/${path}`);
  if (!data) {
    // try index.html for directory paths
    const idx = await readStorageFile(`sites/${siteId}/index.html`);
    if (idx && (path.endsWith("/") || !path.includes("."))) {
      return new Response(idx as any, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  }
  const ext = path.includes(".") ? path.split(".").pop()! : "html";
  const type = TYPES[ext] ?? "application/octet-stream";
  return new Response(data as any, { headers: { "Content-Type": type } });
}
