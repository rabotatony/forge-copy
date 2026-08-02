// ============================================================
// Forge — project detail + delete
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import { db } from '@/lib/db';
import { workflowsForKind, projectDir, sourceZipPath } from '@/lib/forge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    let detection: unknown;
    try {
      detection = JSON.parse(project.detection);
    } catch {
      detection = { type: 'unknown', hints: [] };
    }

    const workflows = workflowsForKind(
      project.kind as Parameters<typeof workflowsForKind>[0],
      detection as Parameters<typeof workflowsForKind>[1],
      project.extractedPath,
    );

    const recentRuns = project.runs.map((r) => ({
      id: r.id,
      workflow: r.workflow,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
    }));

    return Response.json({
      project: {
        id: project.id,
        name: project.name,
        fileName: project.fileName,
        extractedPath: project.extractedPath,
        fileSize: project.fileSize,
        fileCount: project.fileCount,
        kind: project.kind,
        detection,
        createdAt: project.createdAt.toISOString(),
      },
      suggestedWorkflows: workflows.map((w) => ({
        key: w.key,
        name: w.name,
        description: w.description,
        icon: w.icon,
      })),
      recentRuns,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    // Remove extracted directory and the source zip (projectDir covers both).
    try {
      fs.rmSync(projectDir(id), { recursive: true, force: true });
    } catch { /* ignore */ }
    try {
      fs.rmSync(sourceZipPath(id), { force: true });
    } catch { /* ignore */ }

    // Cascade delete removes runs, logs, and artifacts.
    await db.project.delete({ where: { id } });

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
