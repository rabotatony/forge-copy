// ============================================================
// Forge — SSE stream of live run events
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { subscribe, type RunEvent } from '@/lib/forge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KEEPALIVE_MS = 15_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let keepaliveTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const send = (obj: unknown): void => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
    } catch { /* already closed */ }
  };

  // The controller is assigned inside the ReadableStream start() below.
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controllerParam) {
      controller = controllerParam;

      // 1. Send a comment to flush headers immediately.
      controller.enqueue(encoder.encode(': stream-open\n\n'));

      // 2. Replay existing log lines from the DB.
      (async () => {
        try {
          const run = await db.run.findUnique({
            where: { id },
            select: { id: true, status: true },
          });
          if (!run) {
            send({ type: 'error', runId: id, error: 'Run not found' });
            controller.close();
            closed = true;
            return;
          }

          const existing = await db.logLine.findMany({
            where: { runId: id },
            orderBy: { seq: 'asc' },
          });
          for (const l of existing) {
            send({
              type: 'log',
              runId: id,
              log: {
                seq: l.seq,
                stream: l.stream,
                text: l.text,
                ts: l.ts.getTime(),
              },
            });
          }

          // If the run already finished before we connected, emit a done event.
          if (run.status === 'success' || run.status === 'failed' || run.status === 'canceled') {
            const fresh = await db.run.findUnique({
              where: { id },
              select: { status: true, exitCode: true, durationMs: true },
            });
            send({
              type: 'done',
              runId: id,
              status: fresh?.status ?? run.status,
              exitCode: fresh?.exitCode ?? null,
              durationMs: fresh?.durationMs ?? null,
            });
            controller.close();
            closed = true;
            return;
          }

          // 3. Subscribe to live events from the runner.
          const onEvent = (event: RunEvent): void => {
            send(event);
            if (event.type === 'done') {
              if (keepaliveTimer) clearInterval(keepaliveTimer);
              try { controller.close(); } catch { /* ignore */ }
              closed = true;
              if (unsub) { unsub(); unsub = null; }
            }
          };
          unsub = subscribe(id, onEvent);

          // 4. Keepalive comment every 15 s to prevent proxy timeouts.
          keepaliveTimer = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
            } catch { /* ignore */ }
          }, KEEPALIVE_MS);

          // 5. Handle client disconnect.
          request.signal.addEventListener('abort', () => {
            if (closed) return;
            closed = true;
            if (keepaliveTimer) clearInterval(keepaliveTimer);
            if (unsub) { unsub(); unsub = null; }
            try { controller.close(); } catch { /* ignore */ }
          });
        } catch (err) {
          send({
            type: 'error',
            runId: id,
            error: err instanceof Error ? err.message : String(err),
          });
          try { controller.close(); } catch { /* ignore */ }
          closed = true;
        }
      })();
    },
    cancel() {
      closed = true;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (unsub) { unsub(); unsub = null; }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
