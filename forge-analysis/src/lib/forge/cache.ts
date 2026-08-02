// ============================================================
// Forge — content-addressed cache
// ============================================================
// Caches are stored as zip archives on disk, keyed by a content hash.
// Typical use: cache node_modules/ keyed on package-lock.json hash.
//
// Restore: unzip the cached archive to the target path.
// Save: zip the target path and store it.
//
// This solves the #1 GitHub Actions complaint: slow/unreliable cache.
// Our cache is local-disk (instant) and content-addressed (correct).
// ============================================================

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '@/lib/db';
import { PATHS } from './storage';

const CACHE_ROOT = path.join(PATHS.root, 'cache');

function ensureCacheDir(): string {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  return CACHE_ROOT;
}

/**
 * Compute a cache key from one or more input files or strings.
 * Reads each file (if it exists), hashes its content, and combines.
 */
export function computeCacheKey(inputs: Array<{ type: 'file'; path: string } | { type: 'string'; value: string }>): string {
  const hash = crypto.createHash('sha256');
  for (const input of inputs) {
    if (input.type === 'string') {
      hash.update(input.value);
    } else {
      try {
        const content = fs.readFileSync(input.path);
        hash.update(content);
      } catch {
        hash.update(`missing:${input.path}`);
      }
    }
    hash.update('\x00'); // separator
  }
  return hash.digest('hex').slice(0, 32);
}

/**
 * Check if a cache entry exists for the given project + key.
 */
export async function hasCache(projectId: string, key: string): Promise<boolean> {
  const entry = await db.cacheEntry.findUnique({
    where: { projectId_key: { projectId, key } },
  });
  return !!entry && fs.existsSync(entry.path);
}

/**
 * Restore a cache entry: unzip the cached archive to the project root.
 * Returns true if the cache was hit, false on miss.
 */
export async function restoreCache(
  projectId: string,
  key: string,
): Promise<{ hit: boolean; label?: string; size?: number }> {
  const entry = await db.cacheEntry.findUnique({
    where: { projectId_key: { projectId, key } },
  });
  if (!entry || !fs.existsSync(entry.path)) {
    return { hit: false };
  }

  const projectRoot = await getProjectRoot(projectId);
  try {
    await unzipArchive(entry.path, projectRoot);
  } catch (err) {
    // Corrupted cache — remove it.
    await removeCacheEntry(projectId, key);
    return { hit: false };
  }

  // Update last-used + hit count.
  await db.cacheEntry.update({
    where: { id: entry.id },
    data: { lastUsedAt: new Date(), hitCount: { increment: 1 } },
  });

  return { hit: true, label: entry.label, size: entry.size };
}

/**
 * Save a cache entry: zip the given paths and store them.
 */
export async function saveCache(
  projectId: string,
  key: string,
  label: string,
  paths: string[],
): Promise<{ size: number }> {
  const projectRoot = await getProjectRoot(projectId);
  ensureCacheDir();
  const archivePath = path.join(CACHE_ROOT, `${projectId}-${key}.zip`);

  // Zip the paths.
  await zipPaths(paths, projectRoot, archivePath);
  const stat = fs.statSync(archivePath);

  // Upsert the cache entry.
  await db.cacheEntry.upsert({
    where: { projectId_key: { projectId, key } },
    create: {
      projectId,
      key,
      label,
      path: archivePath,
      size: stat.size,
    },
    update: {
      label,
      path: archivePath,
      size: stat.size,
      createdAt: new Date(),
    },
  });

  return { size: stat.size };
}

export async function listCache(projectId: string): Promise<Array<{
  id: string;
  key: string;
  label: string;
  size: number;
  createdAt: Date;
  lastUsedAt: Date;
  hitCount: number;
}>> {
  return db.cacheEntry.findMany({
    where: { projectId },
    orderBy: { lastUsedAt: 'desc' },
  });
}

export async function deleteCache(projectId: string, key: string): Promise<void> {
  await removeCacheEntry(projectId, key);
}

export async function pruneCache(projectId: string, maxEntries: number): Promise<number> {
  const entries = await db.cacheEntry.findMany({
    where: { projectId },
    orderBy: { lastUsedAt: 'desc' },
  });
  if (entries.length <= maxEntries) return 0;
  const toRemove = entries.slice(maxEntries);
  for (const entry of toRemove) {
    try { fs.rmSync(entry.path, { force: true }); } catch { /* ignore */ }
  }
  await db.cacheEntry.deleteMany({
    where: { id: { in: toRemove.map(e => e.id) } },
  });
  return toRemove.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getProjectRoot(projectId: string): Promise<string> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project.extractedPath;
}

async function removeCacheEntry(projectId: string, key: string): Promise<void> {
  const entry = await db.cacheEntry.findUnique({
    where: { projectId_key: { projectId, key } },
  });
  if (!entry) return;
  try { fs.rmSync(entry.path, { force: true }); } catch { /* ignore */ }
  await db.cacheEntry.delete({ where: { id: entry.id } });
}

async function unzipArchive(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-o', '-q', zipPath, '-d', destDir]);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`)));
    child.on('error', reject);
  });
}

async function zipPaths(paths: string[], projectRoot: string, outPath: string): Promise<void> {
  // For each path, zip it relative to projectRoot.
  // We create a temp dir with symlinks, then zip that.
  return new Promise((resolve, reject) => {
    const args = ['-r', '-q', outPath];
    for (const p of paths) {
      args.push(p);
    }
    const child = spawn('zip', args, { cwd: projectRoot });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`zip exited ${code}`)));
    child.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Built-in cache key generators
// ---------------------------------------------------------------------------

/**
 * Standard cache key for Node.js: hash of package-lock.json (or yarn.lock / pnpm-lock.yaml).
 */
export function nodeCacheKey(projectRoot: string): string {
  const lockfile =
    fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml')) ? 'pnpm-lock.yaml' :
    fs.existsSync(path.join(projectRoot, 'yarn.lock')) ? 'yarn.lock' :
    fs.existsSync(path.join(projectRoot, 'bun.lockb')) ? 'bun.lockb' :
    fs.existsSync(path.join(projectRoot, 'package-lock.json')) ? 'package-lock.json' :
    null;
  if (!lockfile) return computeCacheKey([{ type: 'string', value: 'no-lockfile' }]);
  return computeCacheKey([
    { type: 'string', value: 'node-v1' },
    { type: 'file', path: path.join(projectRoot, lockfile) },
  ]);
}

export function cargoCacheKey(projectRoot: string): string {
  const cargoLock = path.join(projectRoot, 'Cargo.lock');
  return computeCacheKey([
    { type: 'string', value: 'cargo-v1' },
    { type: 'file', path: cargoLock },
  ]);
}

export function goCacheKey(projectRoot: string): string {
  const goSum = path.join(projectRoot, 'go.sum');
  return computeCacheKey([
    { type: 'string', value: 'go-v1' },
    { type: 'file', path: goSum },
  ]);
}

export function pythonCacheKey(projectRoot: string): string {
  const reqs = path.join(projectRoot, 'requirements.txt');
  const pyproject = path.join(projectRoot, 'pyproject.toml');
  return computeCacheKey([
    { type: 'string', value: 'python-v1' },
    { type: 'file', path: reqs },
    { type: 'file', path: pyproject },
  ]);
}
