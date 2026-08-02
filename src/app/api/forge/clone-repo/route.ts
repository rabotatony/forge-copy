// ============================================================
// Forge — clone a git repository into a new project
// ============================================================
// POST /api/forge/clone-repo
//   body: { url: string, branch?: string, name?: string, depth?: number }
//   → { project: { id, name, fileName, kind, fileSize, fileCount, createdAt, runCount, lastRunStatus } }
//
// Steps:
//   1. Validate URL (scheme + command-injection sanitization)
//   2. Generate projectId  proj_<timestamp>_<random>
//   3. Create project + extract directories
//   4. git clone --depth <depth> [--branch <branch>] <url> <extractDir>
//   5. On failure → return 400 with git stderr
//   6. detectProject() on the cloned tree
//   7. Persist Project record
//   8. Return project info
//
// SECURITY: we use spawn() WITHOUT a shell so URL/branch are passed as
// distinct argv entries — no shell interpolation can occur. We also
// reject any URL/branch containing shell metacharacters as a
// defense-in-depth measure.
// ============================================================
import type { NextRequest } from 'next/server';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { db } from '@/lib/db';
import { detectProject } from '@/lib/forge/detector';
import { projectDir, extractDir, ensureDirs } from '@/lib/forge/storage';
import { detectProvider } from '@/lib/forge/git';
import { isForbiddenUrl } from '@/lib/forge/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CloneRepoBody {
  url: string;
  branch?: string;
  name?: string;
  depth?: number;
}

// Reject any string containing shell metacharacters. Even though we use
// spawn() without a shell, this prevents weird URLs (e.g. git URL options
// starting with `-`) and serves as defense-in-depth.
const FORBIDDEN_PATTERNS = [';', '|', '&', '$(', '`', '\n', '\r', '\x00'];

function containsShellMetacharacters(value: string): boolean {
  return FORBIDDEN_PATTERNS.some((p) => value.includes(p));
}

/**
 * Spawn `git clone` with the given args (no shell). Resolves on success,
 * rejects with an Error whose message includes stderr on failure.
 */
function runGitClone(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // Drain stdout so the child never blocks on a full pipe buffer.
    child.stdout?.on('data', () => { /* discard */ });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const trimmed = stderr.trim();
        reject(
          new Error(
            `git clone exited with code ${code}${trimmed ? `: ${trimmed}` : ''}`,
          ),
        );
      }
    });
    child.on('error', (err) => reject(err));
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    ensureDirs();

    let body: CloneRepoBody;
    try {
      body = (await request.json()) as CloneRepoBody;
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return Response.json({ error: 'Missing required field: url' }, { status: 400 });
    }

    // Scheme allow-list — only http(s) or ssh-style git@ URLs.
    const schemeOk =
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('git@');
    if (!schemeOk) {
      return Response.json(
        { error: 'URL must start with http://, https://, or git@' },
        { status: 400 },
      );
    }

    // SSRF defense: reject URLs pointing to private/loopback/link-local
    // addresses. This check must run INDEPENDENTLY of the shell-metachar
    // check — a normal URL like http://127.0.0.1/ has no shell metachars
    // but must still be blocked.
    if (isForbiddenUrl(url)) {
      return Response.json(
        { error: 'URL points to a forbidden (private/internal) address' },
        { status: 400 },
      );
    }

    // Command-injection sanitization.
    if (containsShellMetacharacters(url)) {
      return Response.json(
        { error: 'URL contains forbidden characters' },
        { status: 400 },
      );
    }

    // Optional branch — if provided, must be a safe refname.
    let branch: string | undefined;
    if (body.branch !== undefined && body.branch !== null) {
      const b = typeof body.branch === 'string' ? body.branch.trim() : '';
      if (!b) {
        return Response.json({ error: 'branch must be a non-empty string' }, { status: 400 });
      }
      // Git refname rules: no backslash, no control chars, no '..', no spaces
      // around slashes, and must not start with '-' (would look like a flag).
      if (
        containsShellMetacharacters(b) ||
        b.includes('..') ||
        b.includes('\\') ||
        b.includes(' ') ||
        b.startsWith('-') ||
        /[\x00-\x1f\x7f]/.test(b)
      ) {
        return Response.json(
          { error: 'branch contains invalid characters' },
          { status: 400 },
        );
      }
      branch = b;
    }

    // Optional depth — default 1 (shallow clone). Must be a positive int.
    let depth = 1;
    if (body.depth !== undefined && body.depth !== null) {
      const d = typeof body.depth === 'number' ? body.depth : Number(body.depth);
      if (!Number.isInteger(d) || d <= 0) {
        return Response.json(
          { error: 'depth must be a positive integer' },
          { status: 400 },
        );
      }
      depth = d;
    }

    // Generate project id + directories.
    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const dir = projectDir(projectId);
    const extract = extractDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(extract, { recursive: true });

    // Build argv (NO shell — each entry is a single argument).
    const gitArgs = ['clone', '--depth', String(depth)];
    if (branch) {
      gitArgs.push('--branch', branch);
    }
    gitArgs.push(url, extract);

    // Run git clone.
    try {
      await runGitClone(gitArgs);
    } catch (cloneErr) {
      // Clean up the partial clone directory.
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      const message = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
      return Response.json(
        { error: `git clone failed: ${message}` },
        { status: 400 },
      );
    }

    // Some git servers clone into a sub-directory even when given a target
    // path (rare); make sure the extract dir actually contains files.
    if (!fs.existsSync(extract)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return Response.json(
        { error: 'git clone produced no output directory' },
        { status: 500 },
      );
    }

    // Detect project kind from the cloned tree.
    const detection = detectProject(extract);

    // Derive a human-friendly name.
    const rawName =
      (typeof body.name === 'string' ? body.name.trim() : '') ||
      deriveNameFromUrl(url) ||
      'cloned-project';
    const projectName =
      rawName
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/[<>:"'`]/g, '')
        .slice(0, 200) || 'cloned-project';

    // Derive a fileName from the URL (used in the DB).
    const fileName = deriveFileNameFromUrl(url);

    const project = await db.project.create({
      data: {
        id: projectId,
        name: projectName,
        fileName,
        extractedPath: extract,
        fileSize: detection.totalBytes,
        fileCount: detection.fileCount,
        kind: detection.kind,
        detection: JSON.stringify(detection.detection),
        // Repo linkage — the project is born repo-aware so the
        // /repo/* endpoints work immediately after a clone.
        repoUrl: url,
        repoBranch: branch ?? null,
        repoProvider: detectProvider(url),
        repoDepth: depth,
        lastFetchAt: new Date(),
      },
    });

    return Response.json(
      {
        project: {
          id: project.id,
          name: project.name,
          fileName: project.fileName,
          kind: project.kind,
          fileSize: project.fileSize,
          fileCount: project.fileCount,
          createdAt: project.createdAt.toISOString(),
          runCount: 0,
          lastRunStatus: null,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/**
 * Derive a human-friendly project name from a git URL.
 *   https://github.com/foo/bar.git           → "bar"
 *   git@github.com:foo/bar.git               → "bar"
 *   https://github.com/foo/bar               → "bar"
 */
function deriveNameFromUrl(url: string): string {
  // Strip a trailing .git
  const cleaned = url.replace(/\.git$/, '');
  // Take the last path segment.
  const seg = cleaned.split(/[/:]/).filter(Boolean).pop();
  return seg && seg.length > 0 ? seg : '';
}

/**
 * Derive a fileName (identifier) from a git URL — keep scheme + host + path
 * but strip protocol cruft so it stays filesystem-safe-ish as a label.
 */
function deriveFileNameFromUrl(url: string): string {
  const cleaned = url.replace(/\.git$/, '');
  return cleaned.replace(/[^a-zA-Z0-9._:@/-]/g, '').slice(-200) || 'git-clone';
}
