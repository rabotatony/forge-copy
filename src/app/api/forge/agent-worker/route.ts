// ============================================================
// Forge — OpenWorker Agent connector
// ============================================================
// Connects Forge to an OpenWorker "coworker" agent server
// (github.com/andrewyng/openworker) so an autonomous AI agent can
// work for the system from within.
//
// The coworker server exposes an OpenAI-compatible endpoint
// (POST /v1/chat/completions) and a session API. Forge talks to it
// server-to-server (no Origin header => allowed by its origin gate).
//
// GET  /api/forge/agent-worker            -> connection status
// POST /api/forge/agent-worker            -> { action, ... }
//   action:"set-url"  { url }             -> store coworker server URL
//   action:"task"     { prompt }          -> dispatch a task to the agent
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const URL_KEY = "openworker.url";

async function getUrl(): Promise<string | null> {
  try {
    const row = await db.memory.findUnique({ where: { key: URL_KEY } });
    if (!row) return null;
    const v = JSON.parse(row.value);
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
async function setUrl(url: string) {
  await db.memory.upsert({
    where: { key: URL_KEY },
    update: { value: JSON.stringify(url) },
    create: { key: URL_KEY, value: JSON.stringify(url) },
  });
}

function base(url: string) {
  return url.replace(/\/+$/, "");
}

export async function GET(): Promise<Response> {
  const url = await getUrl();
  if (!url) {
    return Response.json({ connected: false, configured: false, note: "No OpenWorker server configured. Set its URL to connect." });
  }
  // health check — the coworker server is OpenAI-compatible; probe /v1/models
  try {
    const r = await fetch(base(url) + "/v1/models", { method: "GET" });
    const ok = r.ok;
    return Response.json({ connected: ok, configured: true, url, status: r.status });
  } catch (e) {
    return Response.json({ connected: false, configured: true, url, error: String(e) });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const action = String(b.action ?? "");

  if (action === "set-url") {
    const url = String(b.url ?? "").trim();
    if (!url) return Response.json({ error: "url required" }, { status: 400 });
    await setUrl(url);
    return Response.json({ ok: true, url });
  }

  if (action === "task") {
    const prompt = String(b.prompt ?? "").trim();
    if (!prompt) return Response.json({ error: "prompt required" }, { status: 400 });
    const url = await getUrl();
    if (!url) return Response.json({ error: "No OpenWorker server configured. Use action:set-url first." }, { status: 400 });
    try {
      const r = await fetch(base(url) + "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: b.model ?? "default",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await r.json().catch(() => null);
      const reply = data?.choices?.[0]?.message?.content ?? null;
      return Response.json({ ok: r.ok, status: r.status, reply, raw: reply ? undefined : data });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 502 });
    }
  }

  return Response.json({ error: "unknown action: " + action }, { status: 400 });
}
