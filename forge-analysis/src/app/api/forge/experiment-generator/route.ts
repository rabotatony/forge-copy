import type { NextRequest } from 'next/server';
import { generateNewExperiments, EXPERIMENTS } from '@/lib/forge/experiments/engine';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(_req: NextRequest) {
  try {
    const logs: Array<{step:string;detail:unknown}> = [];
    const result = await generateNewExperiments(Date.now() + 90_000, (s, d) => logs.push({ step: s, detail: d }));
    return Response.json({ ...result, logs, existingCount: EXPERIMENTS.length });
  } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
}
