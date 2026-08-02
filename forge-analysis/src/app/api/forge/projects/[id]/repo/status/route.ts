// ============================================================
// Forge — git status endpoint
// ============================================================
// GET /api/forge/projects/[id]/repo/status
// Returns the porcelain v1 status of the project's git repo plus
// ahead/behind counts relative to the upstream tracking branch.
//
// Returns: {
//   staged:    Array<{ path, status }>,
//   unstaged:  Array<{ path, status }>,
//   untracked: string[],
//   clean:     boolean,
//   ahead:     number,
//   behind:    number,
// }
//   • 404 if the project doesn't exist
//   • 400 if extractedPath is empty or no `.git`
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { isGitRepo, gitStatus } from '@/lib/forge/git';

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

    const workDir = project.extractedPath ?? '';
    if (!workDir || !isGitRepo(workDir)) {
      return Response.json(
        { error: 'Project is not a git repository. Link a repo first.' },
        { status: 400 },
      );
    }

    const status = await gitStatus(workDir);
    return Response.json(status);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
