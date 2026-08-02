// ============================================================
// Forge — link a git repo to an existing project
// ============================================================
// POST /api/forge/projects/[id]/repo/link
//   body: { url: string, branch?: string, depth?: number }
//
// Links a remote git repository to an existing project by cloning
// it into the project's extract directory. Three cases:
//
//   1. extract dir already has a `.git` → just update repoUrl /
//      repoBranch / repoProvider / repoDepth in the DB (no re-clone).
//   2. extract dir is empty → clone directly into it.
//   3. extract dir has files but no `.git` → clone into a temp dir,
//      then move the `.git` + working tree into the extract dir.
//
// On success, sets repoUrl, repoBranch, repoProvider, repoDepth,
// lastFetchAt and returns the updated project record.
//
// Responses:
//   • 400 on invalid body / URL / branch / depth
//   • 404 if the project doesn't exist
//   • 500 on clone or filesystem failure
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { db } from '@/lib/db';
import {
  cloneRepo,
  detectProvider,
  isGitRepo,
  validateGitUrl,
  validateGitBranch,
} from '@/lib/forge/git';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LinkRepoBody {
  url: string;
  branch?: string;
  depth?: number;
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

/**
 * List the immediate child entries of a directory (files + dirs).
 * Returns an empty array if the directory does not exist.
 */
function listDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Recursively move every entry from `src` into `dest`. Used to merge
 * a freshly-cloned temp tree into an existing extract dir that already
 * has files (case 3 above).
 */
function moveAll(src: string, dest: string): void {
  const entries = listDir(src);
  for (const entry of entries) {
    const from = path.join(src, entry);
    const to = path.join(dest, entry);
    fs.renameSync(from, to);
  }
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

    let body: LinkRepoBody;
    try {
      body = (await request.json()) as LinkRepoBody;
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const urlErr = validateGitUrl(url);
    if (urlErr) {
      return Response.json({ error: urlErr.message }, { status: 400 });
    }

    let branch: string | undefined;
    if (body.branch !== undefined && body.branch !== null) {
      const b = typeof body.branch === 'string' ? body.branch.trim() : '';
      const bErr = validateGitBranch(b);
      if (bErr) {
        return Response.json({ error: bErr.message }, { status: 400 });
      }
      branch = b;
    }

    let depth = 1;
    if (body.depth !== undefined && body.depth !== null) {
      const d =
        typeof body.depth === 'number' ? body.depth : Number(body.depth);
      if (!Number.isInteger(d) || d <= 0) {
        return Response.json(
          { error: 'depth must be a positive integer' },
          { status: 400 },
        );
      }
      depth = d;
    }

    const extractPath = project.extractedPath ?? '';
    if (!extractPath) {
      return Response.json(
        { error: 'Project has no extractedPath on disk' },
        { status: 400 },
      );
    }

    // Make sure the extract dir exists.
    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
    }

    const alreadyGit = isGitRepo(extractPath);
    const existingEntries = listDir(extractPath).filter(
      (e) => e !== '.git',
    );

    if (alreadyGit) {
      // Case 1: already a git repo — just update the DB fields.
      const updated = await db.project.update({
        where: { id },
        data: {
          repoUrl: url,
          repoBranch: branch ?? project.repoBranch,
          repoProvider: detectProvider(url),
          repoDepth: depth,
          lastFetchAt: new Date(),
        },
      });
      return Response.json({ project: serializeProject(updated) });
    }

    // Build the clone destination depending on whether the extract
    // dir is empty or not.
    let cloneDest: string;
    let tempDir: string | null = null;
    let cleanupTemp = false;

    if (existingEntries.length === 0) {
      // Case 2: extract dir is empty — clone directly into it.
      cloneDest = extractPath;
    } else {
      // Case 3: extract dir has files — clone into a temp dir, then
      // move the resulting tree (including .git) into the extract dir.
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-link-'));
      cloneDest = path.join(tempDir, 'repo');
      fs.mkdirSync(cloneDest, { recursive: true });
      cleanupTemp = true;
    }

    // Run the clone (no shell — argv-based).
    const result = await cloneRepo(url, cloneDest, {
      branch,
      depth,
      timeoutMs: 60_000,
    });

    if (result.exitCode !== 0) {
      if (cleanupTemp && tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      const stderr = result.stderr.trim();
      return Response.json(
        {
          error: `git clone failed${stderr ? `: ${stderr}` : ''}`,
          git: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
        },
        { status: 500 },
      );
    }

    // Case 3: move the cloned tree into the extract dir.
    if (tempDir) {
      try {
        moveAll(cloneDest, extractPath);
      } catch (mvErr) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        const msg = mvErr instanceof Error ? mvErr.message : String(mvErr);
        return Response.json(
          { error: `Failed to move cloned tree into project dir: ${msg}` },
          { status: 500 },
        );
      }
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    // Re-read the current branch from the freshly-cloned repo if the
    // caller didn't pin one.
    let finalBranch = branch ?? null;
    if (!finalBranch) {
      // Defer the import to avoid a circular dependency at module
      // load time — git.ts already exports listBranches, but inlining
      // the call here keeps the data flow obvious.
      const { listBranches } = await import('@/lib/forge/git');
      try {
        const info = await listBranches(extractPath);
        finalBranch = info.current || null;
      } catch {
        finalBranch = null;
      }
    }

    const updated = await db.project.update({
      where: { id },
      data: {
        repoUrl: url,
        repoBranch: finalBranch,
        repoProvider: detectProvider(url),
        repoDepth: depth,
        lastFetchAt: new Date(),
      },
    });

    return Response.json(
      { project: serializeProject(updated) },
      { status: 201 },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Serialize a Project record into a plain JSON-safe object.
 */
function serializeProject(p: {
  id: string;
  name: string;
  fileName: string;
  extractedPath: string;
  kind: string;
  repoUrl: string | null;
  repoBranch: string | null;
  repoProvider: string | null;
  repoDepth: number;
  lastPulledAt: Date | null;
  lastFetchAt: Date | null;
}): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    fileName: p.fileName,
    extractedPath: p.extractedPath,
    kind: p.kind,
    repoUrl: p.repoUrl,
    repoBranch: p.repoBranch,
    repoProvider: p.repoProvider,
    repoDepth: p.repoDepth,
    lastPulledAt: p.lastPulledAt ? p.lastPulledAt.toISOString() : null,
    lastFetchAt: p.lastFetchAt ? p.lastFetchAt.toISOString() : null,
  };
}
