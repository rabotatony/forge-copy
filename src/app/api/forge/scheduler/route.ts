import type { NextRequest } from 'next/server';
import { listScheduledJobs, scheduleJob, unscheduleJob, JOB_TEMPLATES } from '@/lib/forge/experiments/engine';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() { return Response.json({ jobs: listScheduledJobs(), templates: JOB_TEMPLATES }); }
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.id || !body.experimentSlug) return Response.json({ error: 'Missing id or experimentSlug' }, { status: 400 });
  const job = scheduleJob(body.id, body.name || body.id, body.interval || 'daily', body.experimentSlug);
  return Response.json({ job });
}
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  unscheduleJob(id);
  return Response.json({ success: true });
}
