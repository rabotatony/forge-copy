// ============================================================
// Forge — git checkout endpoint
// ============================================================
// POST /api/forge/projects/[id]/repo/checkout
//   body: { branch: string }
//
// Runs `git checkout <branch>` in the project's extract dir and
// updates repoBranch in the DB to the new current branch.
//
// Returns: { result: GitResult, branch: string|null }
//   • 400 on invalid body / branch / no `.git`
//   • 404 if the project doesn't exist
//   • 200 even if checkout fails (caller inspects result.exitCode)
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  isGitRepo,
  checkoutBranch,
  listBranches,
  validateGitBranch,
  type GitResult,
} from '@/lib/forge/git';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CheckoutBody {
  branch: string;
}

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

    let body: CheckoutBody;
    try {
      body = (await request.json()) as CheckoutBody;
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const branch =
      typeof body.branch === 'string' ? body.branch.trim() : '';
    const bErr = validateGitBranch(branch);
    if (bErr) {
      return Response.json({ error: bErr.message }, { status: 400 });
    }

    const result: GitResult = await checkoutBranch(workDir, branch);

    // Re-read the current branch to confirm and persist it.
    let newBranch: string | null = null;
    try {
      const info = await listBranches(workDir);
      newBranch = info.current || null;
    } catch {
      newBranch = null;
    }

    if (result.exitCode === 0 && newBranch) {
      await db.project.update({
        where: { id },
        data: { repoBranch: newBranch },
      });
    }

    return Response.json({ result, branch: newBranch });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
