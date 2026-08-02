// Forge — secrets CRUD
import type { NextRequest } from 'next/server';
import { listSecrets, setSecret } from '@/lib/forge/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const secrets = await listSecrets(id);
    return Response.json({ secrets });
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
    await setSecret(id, body.key, body.value);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
