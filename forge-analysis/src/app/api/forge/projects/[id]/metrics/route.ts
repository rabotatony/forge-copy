// ============================================================
// Forge — project code metrics
// ============================================================
// Scans the project files and returns code metrics:
//   • Total lines of code (by language)
//   • File count by extension
//   • Largest files
//   • Dependency count (from package.json/requirements.txt/Cargo.toml)
//
// GET /api/forge/projects/[id]/metrics
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target',
  '__pycache__', '.venv', 'venv', '.cache', 'forge-apk-output',
]);

const EXT_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust',
  '.java': 'Java', '.c': 'C', '.cpp': 'C++',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.md': 'Markdown', '.txt': 'Text',
  '.sh': 'Shell', '.sql': 'SQL',
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    const root = project.extractedPath;
    if (!fs.existsSync(root)) {
      return Response.json({ error: 'Project files not found on disk' }, { status: 404 });
    }

    const langLines = new Map<string, number>();
    const extCounts = new Map<string, number>();
    const largestFiles: Array<{ file: string; lines: number; size: number }> = [];
    let totalFiles = 0;
    let totalLines = 0;
    let totalSize = 0;

    const visit = (dir: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }

      for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          visit(full);
        } else if (e.isFile()) {
          totalFiles++;
          const ext = path.extname(e.name).toLowerCase();
          extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);

          let stat: fs.Stats;
          try { stat = fs.statSync(full); } catch { continue; }
          totalSize += stat.size;

          const lang = EXT_LANG[ext];
          if (lang) {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              const lines = content.split('\n').length;
              langLines.set(lang, (langLines.get(lang) ?? 0) + lines);
              totalLines += lines;
              if (largestFiles.length < 10) {
                largestFiles.push({ file: path.relative(root, full), lines, size: stat.size });
              } else {
                // Replace smallest in top 10.
                const minIdx = largestFiles.indexOf(largestFiles.reduce((a, b) => a.lines < b.lines ? a : b));
                if (lines > largestFiles[minIdx]!.lines) {
                  largestFiles[minIdx] = { file: path.relative(root, full), lines, size: stat.size };
                }
              }
            } catch { /* binary file */ }
          }
        }
      }
    };
    visit(root);

    // Sort languages by lines descending.
    const languages = Array.from(langLines.entries())
      .map(([lang, lines]) => ({ lang, lines, pct: totalLines > 0 ? Math.round((lines / totalLines) * 100) : 0 }))
      .sort((a, b) => b.lines - a.lines);

    // Sort extensions by count.
    const extensions = Array.from(extCounts.entries())
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count);

    // Sort largest files.
    largestFiles.sort((a, b) => b.lines - a.lines);

    // Parse dependencies.
    const deps = parseDependencies(root);

    return Response.json({
      totalFiles,
      totalLines,
      totalSize,
      languages,
      extensions,
      largestFiles,
      dependencies: deps,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function parseDependencies(root: string): { count: number; manager: string | null; list: string[] } {
  // package.json
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = Object.keys(pkg.dependencies ?? {});
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      return { count: deps.length + devDeps.length, manager: 'npm', list: deps.slice(0, 20) };
    } catch { /* ignore */ }
  }

  // requirements.txt
  const reqPath = path.join(root, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    try {
      const lines = fs.readFileSync(reqPath, 'utf-8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      return { count: lines.length, manager: 'pip', list: lines.slice(0, 20) };
    } catch { /* ignore */ }
  }

  // Cargo.toml
  const cargoPath = path.join(root, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      const text = fs.readFileSync(cargoPath, 'utf-8');
      const depMatches = text.match(/^\s*["']?([^"'\s=]+)["']?\s*=/gm) ?? [];
      return { count: depMatches.length, manager: 'cargo', list: [] };
    } catch { /* ignore */ }
  }

  // go.mod
  const goModPath = path.join(root, 'go.mod');
  if (fs.existsSync(goModPath)) {
    try {
      const text = fs.readFileSync(goModPath, 'utf-8');
      const requires = text.split('\n').filter((l) => l.trim().startsWith('\t') && l.includes('.'));
      return { count: requires.length, manager: 'go', list: [] };
    } catch { /* ignore */ }
  }

  return { count: 0, manager: null, list: [] };
}
