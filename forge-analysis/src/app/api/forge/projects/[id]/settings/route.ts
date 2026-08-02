// Forge — project settings
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const settings = await db.projectSettings.findUnique({ where: { projectId: id } });
    if (!settings) {
      return Response.json({
        concurrentCancellation: true,
        defaultRetry: 0,
        defaultTimeoutMs: null,
        maxConcurrentRuns: 1,
        autoSaveCache: true,
        retentionDays: 90,
      });
    }
    return Response.json(settings);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json() as {
      concurrentCancellation?: boolean;
      defaultRetry?: number;
      defaultTimeoutMs?: number | null;
      maxConcurrentRuns?: number;
      autoSaveCache?: boolean;
      retentionDays?: number;
      concurrencyGroup?: string | null;
      cancelInProgress?: boolean;
    };
    const settings = await db.projectSettings.upsert({
      where: { projectId: id },
      create: {
        projectId: id,
        concurrentCancellation: body.concurrentCancellation ?? true,
        defaultRetry: body.defaultRetry ?? 0,
        defaultTimeoutMs: body.defaultTimeoutMs ?? null,
        maxConcurrentRuns: body.maxConcurrentRuns ?? 1,
        autoSaveCache: body.autoSaveCache ?? true,
        retentionDays: body.retentionDays ?? 90,
        concurrencyGroup: body.concurrencyGroup ?? null,
        cancelInProgress: body.cancelInProgress ?? false,
      },
      update: {
        ...(body.concurrentCancellation !== undefined ? { concurrentCancellation: body.concurrentCancellation } : {}),
        ...(body.defaultRetry !== undefined ? { defaultRetry: body.defaultRetry } : {}),
        ...(body.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: body.defaultTimeoutMs } : {}),
        ...(body.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: body.maxConcurrentRuns } : {}),
        ...(body.autoSaveCache !== undefined ? { autoSaveCache: body.autoSaveCache } : {}),
        ...(body.retentionDays !== undefined ? { retentionDays: body.retentionDays } : {}),
        ...(body.concurrencyGroup !== undefined ? { concurrencyGroup: body.concurrencyGroup } : {}),
        ...(body.cancelInProgress !== undefined ? { cancelInProgress: body.cancelInProgress } : {}),
      },
    });
    return Response.json(settings);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
