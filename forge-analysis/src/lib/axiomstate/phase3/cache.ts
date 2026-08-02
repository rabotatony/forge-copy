// ============================================================
// AxiomState Phase 3: CI Cache Invalidation
// ============================================================
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LSSKernel } from '../phase0/kernel';
import { fileId } from '../phase1/ids';
import { loadAllNodes } from '../phase1/loader';
import { sliceReverse } from '../phase1/traversal';
import { HASH_PREFIX } from '../phase2/types';
import type { CacheReport, InvalidationOptions } from './types';

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Given a list of changed source files (relative paths), compute which graph
 * nodes must be rebuilt and which can be safely skipped.
 *
 * Algorithm:
 *   1. Convert file paths to canonical node ids.
 *   2. For each changed file, walk reverse dependencies (who imports me?)
 *      to collect the transitive rebuild set.
 *   3. Any node NOT in the rebuild set can be skipped.
 *
 * No vector search — all edges are exact.
 */
export function computeInvalidation(
  kernel: LSSKernel,
  changedFiles: string[],
  options: InvalidationOptions = {},
): CacheReport {
  const maxDepth = options.maxDepth ?? Infinity;
  const allNodes = loadAllNodes(kernel);
  const mustRebuild = new Set<string>();

  for (const filePath of changedFiles) {
    const id = fileId(filePath);
    // The file itself must rebuild.
    mustRebuild.add(id);
    // All reverse dependencies must also rebuild.
    const slice = sliceReverse(kernel, id, maxDepth);
    for (const nodeId of slice.nodes.keys()) mustRebuild.add(nodeId);
  }

  const canSkip: string[] = [];
  for (const id of allNodes.keys()) {
    if (!mustRebuild.has(id)) canSkip.push(id);
  }

  const mustRebuildArr = Array.from(mustRebuild).sort();
  canSkip.sort();

  return {
    changedFiles,
    mustRebuild: mustRebuildArr,
    canSkip,
    affectedCount: mustRebuild.size,
    totalNodes: allNodes.size,
  };
}

/**
 * Determine which files changed since the last sync by comparing stored
 * content hashes to current disk state.
 *
 * Returns relative file paths that have changed, been added, or been removed.
 */
export function detectChangedFiles(
  kernel: LSSKernel,
  rootDir: string,
): string[] {
  const changed: string[] = [];

  // Check files whose hashes are stored.
  for (const key of kernel.keys()) {
    if (!key.startsWith(HASH_PREFIX)) continue;
    const rel = key.slice(HASH_PREFIX.length);
    const storedHash = kernel.get(key);
    if (!storedHash) continue;
    const full = path.join(rootDir, rel);
    if (!fs.existsSync(full)) {
      changed.push(rel); // deleted
      continue;
    }
    const content = fs.readFileSync(full);
    const currentHash = createHash('sha256').update(content).digest('hex');
    if (new TextDecoder().decode(storedHash) !== currentHash) changed.push(rel);
  }

  return changed.sort();
}

// ---------------------------------------------------------------------------
// Impact analysis
// ---------------------------------------------------------------------------

export interface ImpactReport {
  /** Node ids that transitively depend on any of the changed nodes. */
  impacted: string[];
  /** Direct first-level dependents only. */
  directDependents: string[];
  /** Depth of the longest affected chain. */
  maxDepth: number;
}

/**
 * Analyse the blast radius of changing a set of node ids.
 * Useful for CI dashboards and test-selection tools.
 */
export function analyseImpact(
  kernel: LSSKernel,
  changedNodeIds: string[],
  options: InvalidationOptions = {},
): ImpactReport {
  const maxDepth = options.maxDepth ?? Infinity;
  const allNodes = loadAllNodes(kernel);

  // Build reverse adjacency map.
  const reverseAdj = new Map<string, string[]>();
  for (const [id, node] of allNodes) {
    for (const dep of node.deps) {
      const list = reverseAdj.get(dep) ?? [];
      list.push(id);
      reverseAdj.set(dep, list);
    }
  }

  const impacted = new Set<string>();
  const directDependents = new Set<string>();
  let maxActualDepth = 0;

  // BFS from each changed node through reverse edges.
  for (const startId of changedNodeIds) {
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    const visited = new Set<string>();
    visited.add(startId);

    while (queue.length > 0) {
      const item = queue.shift()!;
      const { id, depth } = item;
      if (depth > maxDepth) continue;
      if (depth > 0) {
        impacted.add(id);
        if (depth === 1) directDependents.add(id);
        if (depth > maxActualDepth) maxActualDepth = depth;
      }
      const dependents = reverseAdj.get(id) ?? [];
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push({ id: dep, depth: depth + 1 });
        }
      }
    }
  }

  return {
    impacted: Array.from(impacted).sort(),
    directDependents: Array.from(directDependents).sort(),
    maxDepth: maxActualDepth,
  };
}

/**
 * Produce a human-readable invalidation summary for CI log output.
 */
export function formatCacheReport(report: CacheReport): string {
  const lines: string[] = [
    `Cache Invalidation Report`,
    `  Changed files   : ${report.changedFiles.length}`,
    `  Must rebuild    : ${report.affectedCount} / ${report.totalNodes} nodes`,
    `  Can skip        : ${report.canSkip.length} nodes`,
    ``,
    `Changed:`,
    ...report.changedFiles.map(f => `  - ${f}`),
    ``,
    `Must rebuild:`,
    ...report.mustRebuild.map(id => `  - ${id}`),
  ];
  return lines.join('\n');
}
