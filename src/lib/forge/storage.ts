// ============================================================
// Forge — storage paths
// ============================================================
// All persistent artifacts live under <project>/storage/.
//   storage/projects/<projectId>/extract/   — extracted ZIP contents
//   storage/projects/<projectId>/source.zip — original upload
//   storage/artifacts/<runId>/<name>        — build outputs
// ============================================================

import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(process.cwd(), 'storage');

export const PATHS = {
  root: ROOT,
  projects: path.join(ROOT, 'projects'),
  artifacts: path.join(ROOT, 'artifacts'),
} as const;

export function ensureDirs(): void {
  for (const p of [PATHS.root, PATHS.projects, PATHS.artifacts]) {
    fs.mkdirSync(p, { recursive: true });
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
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ensureDirs();
