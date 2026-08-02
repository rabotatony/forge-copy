// ============================================================
// Forge — shared filesystem utilities
// ============================================================
// Single source of truth for directory walking + file counting.
// Replaces the three duplicated implementations that existed in
// detector.ts, intelligence.ts, and zip.ts.
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";

/** Directories that are never counted as project source files. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "coverage",
  ".turbo",
  ".idea",
  ".vscode",
]);

export interface FileCountResult {
  fileCount: number;
  totalBytes: number;
}

/**
 * Walk a directory tree and count files (and aggregate byte size),
 * skipping well-known non-source directories. Symlinks are ignored.
 */
export function countFilesInDir(rootDir: string): FileCountResult {
  let fileCount = 0;
  let totalBytes = 0;

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Avoid symlink loops.
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        fileCount++;
        try {
          totalBytes += fs.statSync(full).size;
        } catch {
          /* ignore stat errors on individual files */
        }
      }
    }
  };

  visit(rootDir);
  return { fileCount, totalBytes };
}

/**
 * Recursively list every file under `rootDir` (relative paths). Used
 * by the file-explorer and dependency-scanner.
 */
export function listFiles(rootDir: string, max = 10_000): string[] {
  const out: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
        if (out.length >= max) return;
      }
    }
  };
  visit(rootDir, "");
  return out;
}
