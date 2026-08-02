// Forge — SSE stream of pipeline run events
import type { NextRequest } from 'next/server';
import { getPipelineRun } from '@/lib/forge/pipeline';
import { subscribe } from '@/lib/forge/engine';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KEEPALIVE_MS = 15_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pipelineRunId: string }> },
): Promise<Response> {
  const { pipelineRunId } = await params;

  const encoder = new TextEncoder();
  let closed = false;
  let keepaliveTimer: NodeJS.Timeout | null = null;
  const unsubs: Array<() => void> = [];

  let controller: ReadableStreamDefaultController<Uint8Array>;

  const send = (obj: unknown): void => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
    } catch { /* already closed */ }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controllerParam) {
      controller = controllerParam;
      controller.enqueue(encoder.encode(': pipeline-stream-open\n\n'));

      (async () => {
        try {
          const data = await getPipelineRun(pipelineRunId);
          if (!data) {
            send({ type: 'error', error: 'Pipeline run not found' });
            controller.close();
            return;
          }

          // Send initial state.
          send({ type: 'pipeline-state', pipelineRun: data.pipelineRun, stageRuns: data.stageRuns, runs: data.runs });

          // Subscribe to each child run.
          const runIds = data.runs.map(r => r.id);
          for (const runId of runIds) {
            const unsub = subscribe(runId, (event) => {
              send({ type: 'run-event', runId, event });
            });
            unsubs.push(unsub);
          }

          // Poll pipeline status.
          keepaliveTimer = setInterval(async () => {
            if (closed) return;
            try {
              const fresh = await getPipelineRun(pipelineRunId);
              if (fresh) {
                send({ type: 'pipeline-state', pipelineRun: fresh.pipelineRun, stageRuns: fresh.stageRuns, runs: fresh.runs });
                // Subscribe to any new child runs.
                const freshRunIds = fresh.runs.map(r => r.id);
                for (const rid of freshRunIds) {
                  if (!runIds.includes(rid)) {
                    runIds.push(rid);
                    const unsub = subscribe(rid, (event) => {
                      send({ type: 'run-event', runId: rid, event });
                    });
                    unsubs.push(unsub);
                  }
                }
                if (fresh.pipelineRun.status !== 'running') {
                  send({ type: 'done', status: fresh.pipelineRun.status });
                  controller.close();
                  closed = true;
                }
              }
            } catch { /* ignore poll errors */ }
            if (!closed) {
              try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* ignore */ }
            }
          }, KEEPALIVE_MS);
        } catch (e) {
          send({ type: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      })();
    },
    cancel() {
      closed = true;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
    },
  });

  request.signal.addEventListener('abort', () => {
    closed = true;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
