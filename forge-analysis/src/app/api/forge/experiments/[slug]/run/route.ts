// ============================================================
// Forge — Experiments Lab: run an experiment
// POST /api/forge/experiments/[slug]/run
//   → { runId, verdict, status }  (blocks until the experiment finishes)
// ============================================================
import type { NextRequest } from 'next/server';
import { runExperiment } from '@/lib/forge/experiments/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // experiments can take up to ~4min (with LLM retries)

export async function POST(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const result = await runExperiment(slug);
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 400 });
  }
}
