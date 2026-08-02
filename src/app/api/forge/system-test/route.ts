import { runSystemTest } from '@/lib/forge/experiments/engine';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() { try { return Response.json(runSystemTest()); } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); } }
