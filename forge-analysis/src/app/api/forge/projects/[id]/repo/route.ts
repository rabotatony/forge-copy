// ============================================================
// Forge — repo info endpoint
// ============================================================
// GET /api/forge/projects/[id]/repo
// Returns repository metadata for a project:
//   • isRepo     — true if a `.git` entry exists in extractedPath
//   • url        — repoUrl from the DB (may be null)
//   • branch     — repoBranch from the DB (may be null)
//   • provider   — repoProvider from the DB (may be null)
//   • depth      — repoDepth from the DB (0 = full)
//   • lastPulledAt, lastFetchAt — ISO strings or null
//
// Responses:
//   • 404 if the project doesn't exist
//   • 200 with isRepo=false if extractedPath is empty or no `.git`
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { isGitRepo } from '@/lib/forge/git';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isLikelyProjectId(id: string): boolean {
  // Loose validation: non-empty, no path traversal, reasonable length.
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 256 &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('..')
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!isLikelyProjectId(id)) {
      return Response.json({ error: 'Invalid project id' }, { status: 400 });
    }

    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const extractedPath = project.extractedPath ?? '';
    const isRepo = isGitRepo(extractedPath);

    return Response.json({
      isRepo,
      url: project.repoUrl ?? null,
      branch: project.repoBranch ?? null,
      provider: project.repoProvider ?? null,
      depth: project.repoDepth ?? 0,
      lastPulledAt: project.lastPulledAt
        ? project.lastPulledAt.toISOString()
        : null,
      lastFetchAt: project.lastFetchAt
        ? project.lastFetchAt.toISOString()
        : null,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
