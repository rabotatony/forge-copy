// ============================================================
// Forge — git fetch endpoint
// ============================================================
// POST /api/forge/projects/[id]/repo/fetch
// Runs `git fetch --all` in the project's extract dir and updates
// lastFetchAt.
//
// Returns: { result: GitResult }
//   • 404 if the project doesn't exist
//   • 400 if extractedPath is empty or no `.git`
//   • 200 even if git fetch fails (caller inspects result.exitCode)
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  isGitRepo,
  fetchRepo,
  type GitResult,
} from '@/lib/forge/git';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isLikelyProjectId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 256 &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('..')
  );
}

export async function POST(
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

    const workDir = project.extractedPath ?? '';
    if (!workDir || !isGitRepo(workDir)) {
      return Response.json(
        { error: 'Project is not a git repository. Link a repo first.' },
        { status: 400 },
      );
    }

    const result: GitResult = await fetchRepo(workDir, { timeoutMs: 60_000 });

    await db.project.update({
      where: { id },
      data: { lastFetchAt: new Date() },
    });

    return Response.json({ result });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
