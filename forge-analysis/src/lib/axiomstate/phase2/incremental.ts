// ============================================================
// AxiomState Phase 2: Incremental Graph Synchronizer
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { LSSKernel } from '../phase0/kernel';
import { ProjectParser } from '../phase1/project-parser';
import { KEY_PREFIXES } from '../phase1/types';
import { HASH_PREFIX, SOURCE_PREFIX, FILE_INDEX_PREFIX } from './types';
import type { FileIndex, SyncReport } from './types';

const DEFAULT_EXCLUDES = new Set(['node_modules', '.git', 'dist', 'tmp', 'coverage']);

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface IncrementalEngineOptions {
  exclude?: Set<string>;
}

export class IncrementalEngine {
  private parser: ProjectParser;
  private exclude: Set<string>;

  constructor(options: IncrementalEngineOptions = {}) {
    this.parser = new ProjectParser({ exclude: options.exclude ?? DEFAULT_EXCLUDES });
    this.exclude = options.exclude ?? DEFAULT_EXCLUDES;
  }

  sync(kernel: LSSKernel, rootDir: string): SyncReport {
    const currentFiles = this.scanFiles(rootDir);
    const changed: string[] = [];
    const unchanged: string[] = [];

    for (const rel of currentFiles) {
      const full = path.join(rootDir, rel);
      const content = fs.readFileSync(full);
      const hash = sha256(content);
      const hashKey = `${HASH_PREFIX}${rel}`;
      const previous = kernel.get(hashKey);
      if (previous && new TextDecoder().decode(previous) === hash) {
        unchanged.push(rel);
        continue;
      }
      this.updateFile(kernel, rootDir, rel, content, hash);
      changed.push(rel);
    }

    const removed = this.removeDeleted(kernel, currentFiles);
    return { scanned: currentFiles.length, changed, removed, unchanged: unchanged.length };
  }

  scanFiles(rootDir: string): string[] {
    const files: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (this.exclude.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(full);
        } else if (entry.isFile()) {
          files.push(path.relative(rootDir, full));
        }
      }
    };
    visit(rootDir);
    return files.sort();
  }

  private updateFile(
    kernel: LSSKernel,
    rootDir: string,
    rel: string,
    content: Buffer,
    hash: string,
  ): void {
    this.deleteFileIndex(kernel, rel);
    kernel.apply(`${SOURCE_PREFIX}${rel}`, content);
    const delta = this.parser.parseFile(rootDir, rel);
    const nodeIds: string[] = [];
    for (const node of delta.nodes) {
      kernel.apply(`${KEY_PREFIXES.node}${node.id}`, node.payload);
      nodeIds.push(node.id);
    }
    const edgeKeys: string[] = [];
    for (const edge of delta.edges) {
      const key = `${KEY_PREFIXES.edge}${edge.from}/${edge.to}`;
      const value = edge.meta === undefined
        ? new Uint8Array(0)
        : new TextEncoder().encode(JSON.stringify(edge.meta));
      kernel.apply(key, value);
      edgeKeys.push(key);
    }
    const index: FileIndex = { path: rel, nodeIds, edgeKeys };
    kernel.apply(`${FILE_INDEX_PREFIX}${rel}`, new TextEncoder().encode(JSON.stringify(index)));
    kernel.apply(`${HASH_PREFIX}${rel}`, new TextEncoder().encode(hash));
  }

  private deleteFileIndex(kernel: LSSKernel, rel: string): void {
    const indexRaw = kernel.get(`${FILE_INDEX_PREFIX}${rel}`);
    if (!indexRaw) return;
    const index = JSON.parse(new TextDecoder().decode(indexRaw)) as FileIndex;
    for (const nodeId of index.nodeIds) kernel.apply(`${KEY_PREFIXES.node}${nodeId}`, null);
    for (const edgeKey of index.edgeKeys) kernel.apply(edgeKey, null);
    kernel.apply(`${FILE_INDEX_PREFIX}${rel}`, null);
    kernel.apply(`${SOURCE_PREFIX}${rel}`, null);
  }

  private removeDeleted(kernel: LSSKernel, currentFiles: string[]): string[] {
    const currentSet = new Set(currentFiles);
    const removed: string[] = [];
    for (const key of kernel.keys()) {
      if (!key.startsWith(HASH_PREFIX)) continue;
      const rel = key.slice(HASH_PREFIX.length);
      if (currentSet.has(rel)) continue;
      this.deleteFileIndex(kernel, rel);
      kernel.apply(`${HASH_PREFIX}${rel}`, null);
      removed.push(rel);
    }
    return removed;
  }
}
