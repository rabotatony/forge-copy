// Forge — workflow catalog for a project
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { ALL_WORKFLOWS } from '@/lib/forge/workflows';
import type { Detection } from '@/lib/forge/detector';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: 'unknown', hints: [] } as Detection; }

    const projectRoot = project.extractedPath;
    const workflows = ALL_WORKFLOWS
      .filter(w => {
        if (!w.kinds.includes(project.kind as 'node' | 'python' | 'rust' | 'go' | 'unknown')) return false;
        if (w.build(detection) === null) return false;
        if (w.applies && !w.applies(detection, projectRoot)) return false;
        return true;
      })
      .map(w => ({
        key: w.key,
        name: w.name,
        description: w.description,
        icon: w.icon,
        requiresApproval: w.requiresApproval ?? false,
        secrets: w.secrets ?? [],
        cache: w.cache ?? null,
        testReport: w.testReport ?? null,
      }));

    return Response.json({ workflows });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
