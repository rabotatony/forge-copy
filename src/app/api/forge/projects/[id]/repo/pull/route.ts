// ============================================================
// Forge — git pull endpoint
// ============================================================
// POST /api/forge/projects/[id]/repo/pull
// Runs `git pull --ff-only` in the project's extract dir and updates
// lastPulledAt + repoBranch (re-reads the current branch after the
// pull in case the caller is now on a different ref).
//
// Returns: { result: GitResult, branch: string|null }
//   • 404 if the project doesn't exist
//   • 400 if extractedPath is empty or no `.git`
//   • 200 even if git pull fails (caller inspects result.exitCode)
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  isGitRepo,
  pullRepo,
  listBranches,
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

    const result: GitResult = await pullRepo(workDir, { timeoutMs: 60_000 });

    // Re-read the current branch — a pull can't change branches, but
    // it's cheap and keeps repoBranch honest if it was null.
    let branch: string | null = null;
    try {
      const info = await listBranches(workDir);
      branch = info.current || null;
    } catch {
      branch = null;
    }

    // Update DB fields regardless of exit code — we still want to
    // record that a pull was attempted.
    await db.project.update({
      where: { id },
      data: {
        lastPulledAt: new Date(),
        repoBranch: branch ?? project.repoBranch,
      },
    });

    return Response.json({ result, branch });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
