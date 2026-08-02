// ============================================================
// Forge — git pull (refresh) endpoint
// ============================================================
// POST /api/forge/projects/[id]/git-pull
// Pulls latest changes from the remote for a project that was
// cloned from a git repository.
//
// Returns: { success: boolean, output: string, updated: boolean }
//   • 400 "Not a git repository" if the extracted path has no .git
//   • 404 if the project doesn't exist
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Returns true if `dir` is inside a git work tree (i.e. contains a
 * `.git` directory or is tracked by a parent `.git`).
 */
function isGitRepo(dir: string): boolean {
  if (!dir || !fs.existsSync(dir)) return false;
  // Walk up the directory tree looking for a `.git` entry.
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
 * exit code and combined output (never rejects — callers inspect the
 * code).
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

export async function POST(
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
    if (!root || !fs.existsSync(root)) {
      return Response.json({ error: 'Project files not found on disk' }, { status: 404 });
    }
    if (!isGitRepo(root)) {
      return Response.json({ error: 'Not a git repository' }, { status: 400 });
    }

    const result = await runGit(['pull', '--ff-only'], root);
    const output = (result.stdout + (result.stderr ? `\n${result.stderr}` : '')).trim();

    if (result.code !== 0) {
      return Response.json({
        success: false,
        output,
        updated: false,
      });
    }

    // `git pull --ff-only` prints "Already up to date." when there
    // were no changes, and prints the fetch + fast-forward summary
    // when updates were applied. We treat "Already up to date" (case
    // insensitive) as no update.
    const updated = !/already up to date/i.test(result.stdout);

    return Response.json({
      success: true,
      output,
      updated,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
