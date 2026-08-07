// ============================================================
// Forge — visual self-inspection (screenshot or DOM snapshot)
// ============================================================
// GET /api/forge/visual?url=...
// On real compute with a headless browser -> PNG screenshot (base64).
// Otherwise -> DOM snapshot (server-side fetch of the page HTML).
// ============================================================
import type { NextRequest } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const run = promisify(exec);

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl.searchParams.get("url") || req.nextUrl.origin;
  let browser: string | null = null;
  for (const b of ["chromium", "chromium-browser", "google-chrome"]) {
    try { await run(`command -v ${b}`, { timeout: 5000 }); browser = b; break; } catch {}
  }
  if (browser) {
    try {
      await run(`${browser} --headless --no-sandbox --disable-gpu --screenshot=/tmp/forge-shot.png --window-size=1280,900 ${url}`, { timeout: 40000 });
      const b64 = fs.readFileSync("/tmp/forge-shot.png").toString("base64");
      return Response.json({ mode: "screenshot", bytes: b64.length, pngBase64: b64.slice(0, 400000) });
    } catch (e) {
      return Response.json({ mode: "screenshot-error", error: String(e) });
    }
  }
  try {
    const r = await fetch(url, { headers: { "user-agent": "forge-visual/1.0" } });
    const html = await r.text();
    return Response.json({ mode: "dom-snapshot", status: r.status, html: html.slice(0, 20000), note: "No headless browser on this runtime; DOM snapshot provided instead." });
  } catch (e) {
    return Response.json({ mode: "error", error: String(e) });
  }
}
