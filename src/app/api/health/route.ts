export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// /api/health — runtime-aware health check
//   self-hosted (Node): DB via Prisma/SQLite + storage dir on fs
//   Cloudflare Workers: DB via Prisma/D1 + storage via R2 binding
// ============================================================

function isCloudflareRuntime(): boolean {
  return typeof process !== 'undefined' && process.env?.FORGE_RUNTIME === 'cloudflare';
}

export async function GET(): Promise<Response> {
  const checks: Record<string, string> = {};
  let ok = true;

  // DB (Prisma — SQLite locally, D1 on Cloudflare)
  try {
    const { db } = await import('@/lib/db');
    await db.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'fail';
    ok = false;
  }

  // Storage: local filesystem or R2 bucket
  try {
    if (isCloudflareRuntime()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCloudflareContext } = require('@opennextjs/cloudflare');
      const env = getCloudflareContext().env as Record<string, unknown>;
      const r2 = env.STORAGE as { list?: (o?: { limit?: number }) => Promise<unknown> } | undefined;
      if (r2?.list) {
        await r2.list({ limit: 1 });
        checks.storage = 'ok';
      } else {
        checks.storage = 'fail';
        ok = false;
      }
    } else {
      const fs = await import('node:fs');
      const p = await import('node:path');
      checks.storage = fs.existsSync(p.join(process.cwd(), 'storage')) ? 'ok' : 'fail';
      if (checks.storage === 'fail') ok = false;
    }
  } catch {
    checks.storage = 'fail';
    ok = false;
  }

  return Response.json(
    { status: ok ? 'healthy' : 'unhealthy', checks, uptime: process.uptime() },
    { status: ok ? 200 : 503 },
  );
}
