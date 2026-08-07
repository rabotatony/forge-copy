// ============================================================
// Forge — streaming terminal (SSE) — live output as it happens
// ============================================================
// GET /api/forge/terminal/stream?cmd=...
// Streams stdout/stderr as Server-Sent Events. On edge -> 501.
// ============================================================
import type { NextRequest } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<Response> {
  const cmd = req.nextUrl.searchParams.get("cmd") || "echo forge";
  const enc = new TextEncoder();
  let child: any = null;
  const stream = new ReadableStream({
    start(controller) {
      try {
        child = spawn("sh", ["-c", cmd]);
        const send = (t: string, d: Buffer) => {
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify({ [t]: d.toString() })}\n\n`)); } catch {}
        };
        child.stdout.on("data", (d: Buffer) => send("out", d));
        child.stderr.on("data", (d: Buffer) => send("err", d));
        child.on("exit", (code: number) => {
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify({ exit: code })}\n\n`)); controller.close(); } catch {}
        });
      } catch (e) {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`)); controller.close(); } catch {}
      }
    },
    cancel() { try { child?.kill(); } catch {} },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
