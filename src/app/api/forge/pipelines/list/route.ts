import { listPipelines, PIPELINES } from '@/lib/forge/experiments/engine';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() { return Response.json({ pipelines: listPipelines(), details: PIPELINES }); }
