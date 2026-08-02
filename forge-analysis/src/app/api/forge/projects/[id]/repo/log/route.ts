// ============================================================
// Forge — git log endpoint
// ============================================================
// GET /api/forge/projects/[id]/repo/log?max=30&branch=main
// Returns recent commits from the project's git repo.
//
// Query params:
//   • max    — number of commits to return (default 30, capped at 500)
//   • branch — optional branch/ref to log from (default: HEAD)
//
// Returns: { commits: Array<{ hash, author, email, date, subject }> }
//   • 404 if the project doesn't exist
//   • 400 if extractedPath is empty or no `.git`
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { isGitRepo, gitLog, validateGitBranch } from '@/lib/forge/git';

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
  request: NextRequest,
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

    // Parse query params.
    const sp = request.nextUrl.searchParams;
    let max = 30;
    const rawMax = sp.get('max');
    if (rawMax !== null) {
      const n = Number(rawMax);
      if (Number.isInteger(n) && n > 0) {
        max = Math.min(n, 500);
      } else {
        return Response.json(
          { error: 'max must be a positive integer' },
          { status: 400 },
        );
      }
    }

    let branch: string | undefined;
    const rawBranch = sp.get('branch');
    if (rawBranch !== null) {
      const b = rawBranch.trim();
      if (b) {
        const bErr = validateGitBranch(b);
        if (bErr) {
          return Response.json({ error: bErr.message }, { status: 400 });
        }
        branch = b;
      }
    }

    const commits = await gitLog(workDir, { max, branch });
    return Response.json({ commits });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
