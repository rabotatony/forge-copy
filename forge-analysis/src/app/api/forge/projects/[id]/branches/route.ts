// ============================================================
// Forge — git branch listing endpoint
// ============================================================
// GET /api/forge/projects/[id]/branches
// Lists the remote-tracking branches for a project that was cloned
// from a git repository, plus the currently checked-out branch.
//
// Returns: { branches: string[], current: string | null }
//   • If not a git repo: { branches: [], current: null }
//   • 404 if the project itself doesn't exist
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Returns true if `dir` is inside a git work tree.
 */
function isGitRepo(dir: string): boolean {
  if (!dir || !fs.existsSync(dir)) return false;
  let current = path.resolve(dir);
  while (true) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) return true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a child process, capturing stdout + stderr. Resolves with the
 * exit code and combined output (never rejects).
 */
function runGit(args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      stderr += err.message;
      resolve({ code: -1, stdout, stderr });
    });
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const root = project.extractedPath;
    if (!root || !fs.existsSync(root) || !isGitRepo(root)) {
      return Response.json({ branches: [], current: null });
    }

    // Remote-tracking branches.
    const branchResult = await runGit(['branch', '-r'], root);
    const branches: string[] = [];
    if (branchResult.code === 0) {
      for (const rawLine of branchResult.stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        // Skip the symbolic-ref pointer line, e.g. "origin/HEAD -> origin/main".
        if (line.includes('->')) continue;
        branches.push(line);
      }
    }

    // Currently checked-out branch.
    const headResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    let current: string | null = null;
    if (headResult.code === 0) {
      const name = headResult.stdout.trim();
      // `git rev-parse --abbrev-ref HEAD` returns "HEAD" when in a
      // detached-HEAD state; treat that as no current branch.
      current = name && name !== 'HEAD' ? name : null;
    }

    return Response.json({ branches, current });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
