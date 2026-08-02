// ============================================================
// Forge — token info endpoint (requires valid API token)
// ============================================================
// GET /api/forge/me
//   Authorization: Bearer fk_xxx
//   → { token: { id, name, scopes, projectId } }
// ============================================================
import type { NextRequest } from 'next/server';
import { validateApiToken } from '@/lib/forge/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await validateApiToken(request);
    if (!auth.valid) {
      return Response.json({ error: auth.error ?? 'Unauthorized' }, { status: 401 });
    }
    return Response.json({ token: auth.token });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
