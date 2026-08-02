// Forge — env vars CRUD
import type { NextRequest } from 'next/server';
import { listEnvVars, setEnvVar } from '@/lib/forge/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const envVars = await listEnvVars(id);
    return Response.json({ envVars });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json() as { key: string; value: string };
    if (!body.key || typeof body.value !== 'string') {
      return Response.json({ error: 'key and value required' }, { status: 400 });
    }
    await setEnvVar(id, body.key, body.value);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
