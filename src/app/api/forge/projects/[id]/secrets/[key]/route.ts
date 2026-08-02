// Forge — delete a secret
import type { NextRequest } from 'next/server';
import { deleteSecret } from '@/lib/forge/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }): Promise<Response> {
  try {
    const { id, key } = await params;
    await deleteSecret(id, key);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
