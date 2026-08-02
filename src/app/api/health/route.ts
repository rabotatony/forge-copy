export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(): Promise<Response> {
  const checks: Record<string, string> = {};
  let ok = true;
  try { const { db } = await import('@/lib/db'); await db.$queryRaw`SELECT 1`; checks.db = 'ok'; } catch { checks.db = 'fail'; ok = false; }
  try { const fs = await import('node:fs'); const p = await import('node:path'); checks.storage = fs.existsSync(p.join(process.cwd(), 'storage')) ? 'ok' : 'fail'; if (checks.storage === 'fail') ok = false; } catch { checks.storage = 'fail'; ok = false; }
  return Response.json({ status: ok ? 'healthy' : 'unhealthy', checks, uptime: process.uptime() }, { status: ok ? 200 : 503 });
}
