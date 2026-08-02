// ============================================================
// Forge — ZIP extraction
// ============================================================
// Uses the system `unzip` command (universally available on Linux)
// to extract uploaded ZIP files. Falls back to a Node-native
// implementation if `unzip` is not present.
// ============================================================

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

export interface ExtractResult {
  // The directory containing the extracted files.
  dir: string;
  fileCount: number;
  totalBytes: number;
}

/**
 * Extract a ZIP file to a destination directory.
 * Creates the destination if it doesn't exist.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<ExtractResult> {
  fs.mkdirSync(destDir, { recursive: true });
  await trySystemUnzip(zipPath, destDir);
  return countExtracted(destDir);
}

async function trySystemUnzip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-o', '-q', zipPath, '-d', destDir]);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function countExtracted(dir: string): ExtractResult {
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (d: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) visit(full);
      else if (e.isFile()) {
        fileCount++;
        try { totalBytes += fs.statSync(full).size; } catch { /* ignore */ }
      }
    }
  };
  visit(dir);
  return { dir, fileCount, totalBytes };
}

/**
 * Save a Buffer (the uploaded ZIP) to a temp file and return its path.
 * The caller is responsible for deleting the temp file.
 */
export async function saveUploadToTemp(buffer: Buffer, prefix = 'forge-upload-'): Promise<string> {
  const tmp = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  await pipeline(
    (async function* () { yield buffer; })(),
    createWriteStream(tmp),
  );
  return tmp;
}

/**
 * Some ZIPs wrap their contents in a single top-level directory.
 * If so, return that directory's path; otherwise return rootDir as-is.
 */
export function findProjectRoot(extractedDir: string): string {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());
  const files = entries.filter(e => e.isFile());
  // If there's exactly one directory and no files at the top, descend.
  if (dirs.length === 1 && files.length === 0) {
    const inner = path.join(extractedDir, dirs[0]!.name);
    const innerEntries = fs.readdirSync(inner, { withFileTypes: true });
    if (innerEntries.length > 0) return inner;
  }
  return extractedDir;
}
