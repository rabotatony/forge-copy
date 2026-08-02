// GET /api/forge/projects/[id]/files/search?q=<query>&limit=50
// Search file CONTENTS using ripgrep. Returns matching lines with
// file path + line number + context.
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SearchHit {
  file: string;
  line: number;
  text: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    const q = req.nextUrl.searchParams.get('q')?.trim();
    if (!q || q.length < 2) return Response.json({ error: 'Query too short (min 2 chars)' }, { status: 400 });

    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50, 200);
    const root = project.extractedPath;

    // Use ripgrep (rg) — fast, respects .gitignore, safe (no shell).
    // -n: line numbers, -i: case-insensitive, --max-count: limit per file,
    // --json: machine-readable output.
    const result = await new Promise<SearchHit[]>((resolve, reject) => {
      const child = spawn('rg', [
        '-n', '-i', '--no-heading', '--color', 'never',
        '--max-count', '10',
        '-g', '!node_modules',
        '-g', '!.git',
        '-g', '!.next',
        '-g', '!dist',
        '-g', '!build',
        '--', q, root,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code) => {
        // rg exit 0 = matches, 1 = no matches, 2 = error
        if (code === 2 && stderr) {
          reject(new Error(`rg: ${stderr.slice(0, 200)}`));
          return;
        }
        const hits: SearchHit[] = [];
        for (const line of stdout.split('\n')) {
          if (!line) continue;
          // Format: <full_path>:<line>:<text>
          const m = line.match(/^(.+?):(\d+):(.*)$/);
          if (m) {
            const [, fullPath, lineNum, text] = m;
            hits.push({
              file: path.relative(root, fullPath!).split(path.sep).join('/'),
              line: parseInt(lineNum!, 10),
              text: text!.slice(0, 200),
            });
            if (hits.length >= limit) break;
          }
        }
        resolve(hits);
      });

      child.on('error', () => {
        // rg not installed — fall back to no results (or could use grep).
        resolve([]);
      });

      // Timeout: 10s max
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        resolve([]);
      }, 10_000);
    });

    return Response.json({ hits: result, query: q, total: result.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
