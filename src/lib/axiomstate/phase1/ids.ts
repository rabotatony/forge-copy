// ============================================================
// AxiomState Phase 1: Canonical Graph IDs
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';

export function fileId(filePath: string): string {
  return `file:${normalizePath(filePath)}`;
}

export function symbolId(filePath: string, name: string): string {
  return `symbol:${normalizePath(filePath)}:${name}`;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

const EXTENSION_CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx'];

export function resolveImport(rootDir: string, baseFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // bare/external module
  const baseDir = path.dirname(baseFile);
  const joined = path.join(rootDir, baseDir, specifier);
  const baseWithoutExt = joined.replace(/\.(js|jsx|ts|tsx)$/i, '');
  for (const ext of EXTENSION_CANDIDATES) {
    const candidate = baseWithoutExt + ext;
    if (fs.existsSync(candidate)) {
      const rel = path.relative(rootDir, candidate);
      return normalizePath(rel);
    }
  }
  return null;
}
