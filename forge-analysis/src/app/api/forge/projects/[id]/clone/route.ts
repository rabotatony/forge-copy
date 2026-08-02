// ============================================================
// Forge — project clone endpoint
// ============================================================
// POST /api/forge/projects/[id]/clone
// Duplicates an existing project: copies the extracted files to a
// new project directory and creates a new Project record with the
// same fileName, kind, and detection metadata but a fresh id and an
// "{originalName} (copy)" name.
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { projectDir, extractDir, ensureDirs } from '@/lib/forge/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Spawn `cp -r src/. dest` to recursively copy the contents of `src`
 * into `dest`. Resolves on success, rejects with a descriptive Error
 * on failure (non-zero exit, spawn error, or stderr output).
 */
function copyDir(src: string, dest: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('cp', ['-r', `${src}/.`, dest], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cp exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
    child.on('error', (err) => reject(err));
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    ensureDirs();
    const { id } = await params;

    const original = await db.project.findUnique({ where: { id } });
    if (!original) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    // Verify the source files still exist on disk.
    if (!fs.existsSync(original.extractedPath)) {
      return Response.json(
        { error: 'Original project files are missing on disk' },
        { status: 410 },
      );
    }

    // Generate a new project id matching the upload route's format.
    const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const newProjectDir = projectDir(newId);
    const newExtract = extractDir(newId);
    fs.mkdirSync(newProjectDir, { recursive: true });
    fs.mkdirSync(newExtract, { recursive: true });

    // Compute the new extractedPath. If the original extractedPath was the
    // extract root, the copy lives at the new extract root. If it was a
    // sub-directory (e.g. extract/my-app/), preserve that relative path so
    // downstream tools resolve files from the same logical location.
    const origExtractRoot = extractDir(original.id);
    const relative = path.relative(origExtractRoot, original.extractedPath);
    const safeRelative =
      relative && relative !== '.' && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative
        : '';
    const newExtractedPath = safeRelative ? path.join(newExtract, safeRelative) : newExtract;

    // Ensure the destination directory exists before copying.
    fs.mkdirSync(path.dirname(newExtractedPath), { recursive: true });
    fs.mkdirSync(newExtractedPath, { recursive: true });

    try {
      await copyDir(original.extractedPath, newExtractedPath);
    } catch (copyErr) {
      // Clean up the partial copy so we don't leave an orphaned directory.
      try {
        fs.rmSync(newProjectDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return Response.json(
        {
          error: `Failed to copy project files: ${
            copyErr instanceof Error ? copyErr.message : 'unknown'
          }`,
        },
        { status: 500 },
      );
    }

    const created = await db.project.create({
      data: {
        id: newId,
        name: `${original.name} (copy)`,
        fileName: original.fileName,
        extractedPath: newExtractedPath,
        fileSize: original.fileSize,
        fileCount: original.fileCount,
        kind: original.kind,
        detection: original.detection,
      },
    });

    return Response.json({
      project: {
        id: created.id,
        name: created.name,
        kind: created.kind,
        fileCount: created.fileCount,
        createdAt: created.createdAt.toISOString(),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
