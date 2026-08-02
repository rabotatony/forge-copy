// ============================================================
// AxiomState Phase 2: Deterministic Bundle Generator
// ============================================================
import { LSSKernel } from '../phase0/kernel';
import { loadAllNodes } from '../phase1/loader';
import { SOURCE_PREFIX } from './types';
import type { BundleResult, BundleEntry } from './types';

/**
 * Given a set of file node ids, produce a topologically ordered bundle
 * where dependencies appear before dependents (Kahn's algorithm).
 */
export function bundleFiles(kernel: LSSKernel, fileIds: Set<string> | string[]): BundleResult {
  const ids = new Set<string>(fileIds);
  const allNodes = loadAllNodes(kernel);

  // Build adjacency restricted to the requested set.
  // depsOf[id] = set of ids in the bundle that id depends on.
  const depsOf = new Map<string, Set<string>>();
  const rdepsOf = new Map<string, Set<string>>(); // reverse: who depends on me

  for (const id of ids) {
    const node = allNodes.get(id);
    const deps = new Set<string>();
    if (node) {
      for (const dep of node.deps) {
        if (ids.has(dep)) deps.add(dep);
      }
    }
    depsOf.set(id, deps);
  }

  for (const [id, deps] of depsOf) {
    for (const dep of deps) {
      const rs = rdepsOf.get(dep) ?? new Set<string>();
      rs.add(id);
      rdepsOf.set(dep, rs);
    }
  }

  // Kahn's algorithm for topological sort.
  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, depsOf.get(id)!.size);

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort(); // deterministic tie-breaking

  const order: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    visited.add(id);
    const dependents = Array.from(rdepsOf.get(id) ?? []).sort();
    for (const dep of dependents) {
      const newDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  // Detect cycles: any node not in visited is part of a cycle.
  const cycles: string[][] = [];
  const seen = new Set<string>(visited);
  for (const start of ids) {
    if (seen.has(start)) continue;
    const cycle: string[] = [];
    const path: string[] = [];
    const pathSet = new Set<string>();
    const walk = (id: string): boolean => {
      if (pathSet.has(id)) {
        const idx = path.indexOf(id);
        cycles.push(path.slice(idx));
        return true;
      }
      if (visited.has(id) || !depsOf.has(id)) return false;
      path.push(id);
      pathSet.add(id);
      seen.add(id);
      for (const next of Array.from(depsOf.get(id)!).sort()) {
        if (walk(next)) return true;
      }
      path.pop();
      pathSet.delete(id);
      return false;
    };
    walk(start);
    void cycle;
  }

  const entries: BundleEntry[] = order.map(id => {
    const sourceKey = `${SOURCE_PREFIX}${extractPath(id)}`;
    const content = kernel.get(sourceKey) ?? new Uint8Array(0);
    return { id, path: extractPath(id), content };
  });

  return { order, entries, cycles };
}

function extractPath(id: string): string {
  if (id.startsWith('file:')) return id.slice('file:'.length);
  return id;
}
