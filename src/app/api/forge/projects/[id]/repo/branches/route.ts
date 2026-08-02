// ============================================================
// Forge — list branches endpoint
// ============================================================
// GET /api/forge/projects/[id]/repo/branches
// Lists local + remote-tracking branches and the currently
// checked-out branch.
//
// Returns: { current: string, branches: Array<{ name, current, remote }> }
//   • 404 if the project doesn't exist
//   • 400 if extractedPath is empty or no `.git`
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { isGitRepo, listBranches } from '@/lib/forge/git';

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

    const info = await listBranches(workDir);
    return Response.json(info);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
