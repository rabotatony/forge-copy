// ============================================================
// Forge — audit log API
// ============================================================
// GET /api/forge/audit-log?page=1&limit=50&action=run.started
// Returns paginated audit log entries.
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const action = url.searchParams.get('action');
    const entityType = url.searchParams.get('entityType');

    const where: { action?: string; entityType?: string } = {};
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;

    const [entries, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.auditLog.count({ where }),
    ]);

    return Response.json({
      entries,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
