// ============================================================
// Forge — file tree of an extracted project
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv',
]);
const MAX_ENTRIES = 500;

interface TreeNode {
  type: 'dir' | 'file';
  path: string;
  size: number;
  childrenCount: number;
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
    if (!root || !fs.existsSync(root)) {
      return Response.json({ tree: [], totalFiles: 0, truncated: false });
    }

    const tree: TreeNode[] = [];
    let totalFiles = 0;
    let truncated = false;

    const visit = (dir: string): void => {
      if (truncated) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      // Sort: directories first, then files, alphabetical.
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const e of entries) {
        if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(root, full).split(path.sep).join('/');
        let size = 0;
        let childrenCount = 0;
        try {
          if (e.isFile()) {
            size = fs.statSync(full).size;
            totalFiles++;
          } else if (e.isDirectory()) {
            // Count direct children for context.
            childrenCount = fs.readdirSync(full).length;
          }
        } catch { /* ignore */ }

        if (tree.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }
        tree.push({
          type: e.isDirectory() ? 'dir' : 'file',
          path: rel,
          size,
          childrenCount,
        });

        if (e.isDirectory()) visit(full);
      }
    };

    visit(root);

    return Response.json({ tree, totalFiles, truncated });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
