// ============================================================
// Forge — storage I/O adapter (fs local / R2 on Workers)
// ============================================================
// Routes file reads/writes to:
//   Local / VPS : real filesystem under PATHS.root
//   Workers     : R2 bucket (binding STORAGE, wrangler.jsonc)
//
// All paths are RELATIVE to the storage root so R2 keys mirror the
// on-disk layout (projects/<id>/..., artifacts/<run>/...).
// Call sites should migrate from direct fs to these helpers.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PATHS } from '@/lib/forge/storage';

function isWorkers(): boolean {
  if (typeof process !== 'undefined' && process.env?.FORGE_RUNTIME === 'cloudflare') return true;
  try {
    const g = globalThis as Record<string, unknown>;
    if (typeof g.caches !== 'undefined' && typeof (g.caches as Record<string, unknown>).default !== 'undefined') return true;
  } catch { /* ignore */ }
  return false;
}

// Lazily get the R2 bucket binding (Workers only).
function getR2(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCloudflareContext } = require('@opennextjs/cloudflare');
  // Note: installed @opennextjs/cloudflare exports getCloudflareContext
  // (the older getRequestContext no longer exists).
  const ctx = getCloudflareContext();
  return (ctx.env as Record<string, unknown>).STORAGE;
}

function toRel(p: string): string {
  const rel = path.relative(PATHS.root, path.resolve(p));
  return rel.split(path.sep).join('/');
}

export async function readStorageFile(absOrRel: string): Promise<Buffer | null> {
  const rel = toRel(absOrRel);
  if (isWorkers()) {
    try {
      const obj = await getR2().get(rel);
      if (!obj) return null;
      return Buffer.from(await obj.arrayBuffer());
    } catch {
      return null;
    }
  }
  const abs = path.resolve(PATHS.root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs) : null;
}

export async function writeStorageFile(absOrRel: string, data: Buffer | string): Promise<void> {
  const rel = toRel(absOrRel);
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  if (isWorkers()) {
    await getR2().put(rel, buf);
    return;
  }
  const abs = path.resolve(PATHS.root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

export async function writeStorageStream(absOrRel: string, stream: ReadableStream): Promise<void> {
  const rel = toRel(absOrRel);
  if (!isWorkers()) {
    // local fs: collect stream then write
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) chunks.push(value); }
    fs.mkdirSync(path.dirname(absOrRel), { recursive: true });
    fs.writeFileSync(absOrRel, Buffer.concat(chunks as any));
    return;
  }
  await getR2().put(rel, stream);
}

export async function deleteStorageFile(absOrRel: string): Promise<void> {
  const rel = toRel(absOrRel);
  if (isWorkers()) {
    await getR2().delete(rel);
    return;
  }
  const abs = path.resolve(PATHS.root, rel);
  if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
}

export async function storageFileExists(absOrRel: string): Promise<boolean> {
  const rel = toRel(absOrRel);
  if (isWorkers()) {
    const head = await getR2().head(rel);
    return !!head;
  }
  return fs.existsSync(path.resolve(PATHS.root, rel));
}
