// ============================================================
// Forge — storage paths (Workers-safe)
// ============================================================
// All persistent artifacts live under <project>/storage/.
//   storage/projects/<projectId>/extract/   — extracted ZIP contents
//   storage/projects/<projectId>/source.zip — original upload
//   storage/artifacts/<runId>/<name>        — build outputs
//
// Local / dev / VPS : real filesystem (unchanged behavior).
// Cloudflare Workers: fs is unavailable; file bytes live in R2
//   (binding STORAGE, see wrangler.jsonc). Path helpers still return
//   the same relative structure so R2 keys mirror the old paths.
//   File *I/O* is routed through the storage adapter (see storage-io).
// NOTE: ensureDirs() is lazy — it must NOT run at module load, or the
//   Worker would crash (fs unavailable outside request + no disk).
// ============================================================

import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(process.cwd(), 'storage');

export const PATHS = {
  root: ROOT,
  projects: path.join(ROOT, 'projects'),
  artifacts: path.join(ROOT, 'artifacts'),
} as const;

let dirsEnsured = false;
export function ensureDirs(): void {
  if (dirsEnsured) return;
  try {
    for (const p of [PATHS.root, PATHS.projects, PATHS.artifacts]) {
      fs.mkdirSync(p, { recursive: true });
    }
    dirsEnsured = true;
  } catch {
    // On Workers (no fs) this is a no-op; files live in R2 instead.
  }
}

export function projectDir(projectId: string): string {
  return path.join(PATHS.projects, projectId);
}

export function extractDir(projectId: string): string {
  return path.join(projectDir(projectId), 'extract');
}

export function sourceZipPath(projectId: string): string {
  return path.join(projectDir(projectId), 'source.zip');
}

export function runArtifactDir(runId: string): string {
  const dir = path.join(PATHS.artifacts, runId);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // no fs on Workers — directory concept lives in R2 keys
  }
  return dir;
}

// NOTE: ensureDirs() is intentionally NOT called at module load anymore.
// Call sites that need directories call ensureDirs() or mkdirSync({recursive:true}).
