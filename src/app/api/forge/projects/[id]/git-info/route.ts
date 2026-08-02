// ============================================================
// Forge — git info endpoint
// ============================================================
// GET /api/forge/projects/[id]/git-info
// Returns git metadata for a project cloned from a git repository:
//   • recent commits   (git log --oneline -5)
//   • remote URL       (git remote -v)
//   • current commit   (git rev-parse HEAD)
//   • current branch   (git rev-parse --abbrev-ref HEAD)
//
// Returns: {
//   isGit: boolean,
//   remote: string | null,
//   commit: string | null,
//   commits: string[],
//   branch: string | null,
// }
//   • If not a git repo: { isGit: false, remote: null, commit: null,
//     commits: [], branch: null }
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
      return Response.json({
        isGit: false,
        remote: null,
        commit: null,
        commits: [],
        branch: null,
      });
    }

    // Recent commits — `git log --oneline -5`.
    const logResult = await runGit(['log', '--oneline', '-5'], root);
    const commits: string[] = [];
    if (logResult.code === 0) {
      for (const rawLine of logResult.stdout.split('\n')) {
        const line = rawLine.trim();
        if (line) commits.push(line);
      }
    }

    // Remote URL — take the first line of `git remote -v`, which is
    // typically "origin\t<url> (fetch)".
    const remoteResult = await runGit(['remote', '-v'], root);
    let remote: string | null = null;
    if (remoteResult.code === 0) {
      const firstLine = remoteResult.stdout.split('\n')[0] ?? '';
      // Format: "<name>\t<url> (fetch)". Extract the URL.
      const m = firstLine.match(/^\S+\s+(\S+)/);
      if (m) remote = m[1] ?? null;
    }

    // Current commit hash — `git rev-parse HEAD`.
    const commitResult = await runGit(['rev-parse', 'HEAD'], root);
    let commit: string | null = null;
    if (commitResult.code === 0) {
      const hash = commitResult.stdout.trim();
      commit = hash || null;
    }

    // Current branch — `git rev-parse --abbrev-ref HEAD`.
    const branchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    let branch: string | null = null;
    if (branchResult.code === 0) {
      const name = branchResult.stdout.trim();
      // Returns "HEAD" when in detached-HEAD state.
      branch = name && name !== 'HEAD' ? name : null;
    }

    return Response.json({
      isGit: true,
      remote,
      commit,
      commits,
      branch,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
