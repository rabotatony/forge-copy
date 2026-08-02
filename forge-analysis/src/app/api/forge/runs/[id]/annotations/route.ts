// ============================================================
// Forge — run annotations (errors, warnings, notices)
// ============================================================
// GET  /api/forge/runs/[id]/annotations — list annotations
// POST /api/forge/runs/[id]/annotations — add annotation
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const annotations = await db.annotation.findMany({
      where: { runId: id },
      orderBy: { createdAt: 'asc' },
    });
    return Response.json({ annotations, count: annotations.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await req.json() as {
      level: 'error' | 'warning' | 'notice';
      message: string;
      file?: string;
      line?: number;
      column?: number;
    };

    if (!body.level || !body.message?.trim()) {
      return Response.json({ error: 'level and message required' }, { status: 400 });
    }

    const annotation = await db.annotation.create({
      data: {
        runId: id,
        level: body.level,
        message: body.message.trim().slice(0, 1000),
        file: body.file?.slice(0, 500) ?? null,
        line: body.line ?? null,
        column: body.column ?? null,
      },
    });

    return Response.json({ annotation }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
