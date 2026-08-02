// ============================================================
// Forge — read a single file's UTF-8 content
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 200 * 1024; // 200 KB

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const relParam = url.searchParams.get('path');
    if (!relParam) {
      return Response.json({ error: 'Missing ?path= query parameter' }, { status: 400 });
    }

    const root = path.resolve(project.extractedPath);
    const resolved = path.resolve(root, relParam);

    // Reject paths that escape the project root.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return Response.json(
        { error: 'Path escapes the project root' },
        { status: 400 },
      );
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolved);
    const truncated = stat.size > MAX_BYTES;
    const readBytes = truncated ? MAX_BYTES : stat.size;

    // Open a file descriptor and read up to readBytes.
    const fd = fs.openSync(resolved, 'r');
    let buf: Buffer;
    try {
      buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, 0);
    } finally {
      fs.closeSync(fd);
    }

    const content = buf.toString('utf-8');

    return Response.json({
      path: path.relative(root, resolved).split(path.sep).join('/'),
      content,
      size: stat.size,
      truncated,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
