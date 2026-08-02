// ============================================================
// AxiomState Phase 3: Query Planner & Index
// ============================================================
import { LSSKernel } from '../phase0/kernel';
import { loadAllNodes, loadNode } from '../phase1/loader';
import { sliceForward, sliceReverse } from '../phase1/traversal';
import type { Query } from '../phase2/query';
import type {
  QueryIndex,
  QueryPlan,
  KernelSnapshot,
  SnapshotDiff,
} from './types';

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Build an in-memory index from the current kernel state.
 * O(K) where K = number of graph nodes.
 * The index enables O(1) kind lookups and O(1)-amortized name lookups.
 */
export function buildIndex(kernel: LSSKernel): QueryIndex {
  const byKind = new Map<string, Set<string>>();
  const byName = new Map<string, string[]>();
  const allNodes = loadAllNodes(kernel);

  for (const [id, node] of allNodes) {
    // kind index
    const kindSet = byKind.get(node.kind) ?? new Set<string>();
    kindSet.add(id);
    byKind.set(node.kind, kindSet);

    // name index (lowercase for case-insensitive lookups)
    const nameLower = node.name.toLowerCase();
    const nameList = byName.get(nameLower) ?? [];
    nameList.push(id);
    byName.set(nameLower, nameList);
  }

  return {
    byKind,
    byName,
    builtAt: kernel.stats().seq,
    nodeCount: allNodes.size,
  };
}

/**
 * Check whether an existing index is still valid for the current kernel state.
 * An index is stale if the kernel has advanced past the sequence at which it was built.
 */
export function isIndexStale(kernel: LSSKernel, index: QueryIndex): boolean {
  return kernel.stats().seq !== index.builtAt;
}

// ---------------------------------------------------------------------------
// Query Planner
// ---------------------------------------------------------------------------

/**
 * Translate a Query into an execution QueryPlan.
 * The planner picks the cheapest strategy:
 *   - kind/name queries → index lookup when an index is provided
 *   - and(kind, ...) → intersect with index on the cheapest operand first
 *   - node, deps, rdeps → exact graph operations
 */
export function plan(query: Query, index?: QueryIndex): QueryPlan {
  return planQuery(query, index);
}

function planQuery(query: Query, index?: QueryIndex): QueryPlan {
  switch (query.op) {
    case 'node':
      return { strategy: 'exact-node', id: query.id };

    case 'deps':
      return { strategy: 'graph-forward', of: query.of, depth: query.depth };

    case 'rdeps':
      return { strategy: 'graph-reverse', of: query.of, depth: query.depth };

    case 'kind':
      if (index) return { strategy: 'index-kind', kind: query.kind };
      return { strategy: 'full-scan', reason: 'no index — kind scan' };

    case 'name':
      if (index) return { strategy: 'index-name', pattern: query.pattern };
      return { strategy: 'full-scan', reason: 'no index — name scan' };

    case 'and': {
      if (query.q.length === 0) return { strategy: 'full-scan', reason: 'empty and' };
      // Heuristic: put cheapest (index-based) plans first.
      const subplans = query.q
        .map(q => planQuery(q, index))
        .sort((a, b) => planCost(a) - planCost(b));
      return { strategy: 'intersect', plans: subplans };
    }

    case 'or': {
      const subplans = query.q.map(q => planQuery(q, index));
      return { strategy: 'union', plans: subplans };
    }

    case 'not': {
      const inner = planQuery(query.q, index);
      const universe: QueryPlan = index
        ? { strategy: 'index-kind', kind: 'file' }  // approximate — refined at execute time
        : { strategy: 'full-scan', reason: 'not — universe scan' };
      return { strategy: 'difference', universe, exclude: inner };
    }
  }
}

/** Relative cost estimate for a plan (lower = cheaper). */
function planCost(p: QueryPlan): number {
  switch (p.strategy) {
    case 'exact-node': return 0;
    case 'index-kind': return 1;
    case 'index-name': return 2;
    case 'graph-forward': return p.depth !== undefined ? 3 : 10;
    case 'graph-reverse': return p.depth !== undefined ? 3 : 10;
    case 'intersect': return Math.max(...p.plans.map(planCost));
    case 'union': return p.plans.reduce((s, q) => s + planCost(q), 0);
    case 'difference': return planCost(p.universe) + planCost(p.exclude);
    case 'full-scan': return 100;
  }
}

// ---------------------------------------------------------------------------
// Index-accelerated evaluator
// ---------------------------------------------------------------------------

/**
 * Execute a QueryPlan against the kernel, using the provided index when available.
 * Falls back to full graph loads for unsupported strategies.
 */
export function executePlan(
  kernel: LSSKernel,
  plan: QueryPlan,
  index?: QueryIndex,
): Set<string> {
  switch (plan.strategy) {
    case 'exact-node': {
      const found = loadNode(kernel, plan.id) !== undefined;
      return found ? new Set([plan.id]) : new Set();
    }

    case 'index-kind': {
      if (index) {
        return new Set(index.byKind.get(plan.kind) ?? []);
      }
      // Fallback: load all nodes and filter.
      const all = loadAllNodes(kernel);
      const result = new Set<string>();
      for (const [id, node] of all) if (node.kind === plan.kind) result.add(id);
      return result;
    }

    case 'index-name': {
      const re = globToRegex(plan.pattern);
      if (index) {
        const result = new Set<string>();
        for (const [nameLower, ids] of index.byName) {
          if (re.test(nameLower)) for (const id of ids) result.add(id);
        }
        // Also test original-case from the index (ids) by checking the node name.
        // The byName map uses lowercase keys; we test against the pattern as-is.
        // For non-wildcard patterns this is fine; for case-sensitive patterns
        // we do a secondary pass.
        const reCaseSensitive = globToRegex(plan.pattern);
        const result2 = new Set<string>();
        for (const [, ids] of index.byName) {
          for (const id of ids) {
            const node = loadNode(kernel, id);
            if (node && reCaseSensitive.test(node.name)) result2.add(id);
          }
        }
        return result2;
      }
      const all = loadAllNodes(kernel);
      const result = new Set<string>();
      for (const [id, node] of all) if (re.test(node.name)) result.add(id);
      return result;
    }

    case 'graph-forward': {
      const slice = sliceForward(kernel, plan.of, plan.depth ?? Infinity);
      return new Set(slice.nodes.keys());
    }

    case 'graph-reverse': {
      const slice = sliceReverse(kernel, plan.of, plan.depth ?? Infinity);
      return new Set(slice.nodes.keys());
    }

    case 'intersect': {
      if (plan.plans.length === 0) return new Set();
      const [first, ...rest] = plan.plans;
      let result = executePlan(kernel, first!, index);
      for (const sub of rest) {
        const next = executePlan(kernel, sub, index);
        result = intersect(result, next);
        if (result.size === 0) break; // early exit
      }
      return result;
    }

    case 'union': {
      const result = new Set<string>();
      for (const sub of plan.plans) {
        for (const id of executePlan(kernel, sub, index)) result.add(id);
      }
      return result;
    }

    case 'difference': {
      const all = loadAllNodes(kernel);
      const excluded = executePlan(kernel, plan.exclude, index);
      const result = new Set<string>();
      for (const id of all.keys()) {
        if (!excluded.has(id)) result.add(id);
      }
      return result;
    }

    case 'full-scan': {
      const all = loadAllNodes(kernel);
      return new Set(all.keys());
    }
  }
}

/**
 * High-level: plan and execute a query with optional index acceleration.
 */
export function evaluatePlanned(
  kernel: LSSKernel,
  query: Query,
  index?: QueryIndex,
): Set<string> {
  const p = plan(query, index);
  return executePlan(kernel, p, index);
}

// ---------------------------------------------------------------------------
// Snapshot diff
// ---------------------------------------------------------------------------

/**
 * Take a snapshot of all live kernel key-value pairs.
 */
export function takeSnapshot(kernel: LSSKernel): KernelSnapshot {
  const entries = new Map<string, Uint8Array>();
  for (const key of kernel.keys()) {
    const val = kernel.get(key);
    if (val !== undefined) entries.set(key, val);
  }
  return { entries, takenAt: kernel.stats().seq };
}

/**
 * Compute the diff between two snapshots.
 * Useful for determining what changed between two sync operations.
 */
export function diffSnapshots(before: KernelSnapshot, after: KernelSnapshot): SnapshotDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [key, afterVal] of after.entries) {
    const beforeVal = before.entries.get(key);
    if (beforeVal === undefined) {
      added.push(key);
    } else if (!uint8ArrayEqual(beforeVal, afterVal)) {
      changed.push(key);
    }
  }

  for (const key of before.entries.keys()) {
    if (!after.entries.has(key)) removed.push(key);
  }

  added.sort();
  removed.sort();
  changed.sort();

  return {
    added,
    removed,
    changed,
    totalDelta: added.length + removed.length + changed.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  const [smaller, larger] = a.size < b.size ? [a, b] : [b, a];
  for (const id of smaller) if (larger.has(id)) result.add(id);
  return result;
}

function uint8ArrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function globToRegex(pattern: string): RegExp {
  let re = '^';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += escapeRegex(ch);
  }
  re += '$';
  return new RegExp(re);
}

function escapeRegex(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}
