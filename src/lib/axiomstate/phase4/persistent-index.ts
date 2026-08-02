// ============================================================
// AxiomState Phase 4: Persistent Index
// ============================================================
// Serialises a QueryIndex into the LSS kernel under idx://v1/ keys.
// Cold starts load the index in O(B) (number of kind/name buckets)
// rather than O(K) (number of graph nodes), avoiding a full node scan.
// Incremental patches update only the buckets touched by a sync.
// ============================================================

import { LSSKernel } from '../phase0/kernel';
import { loadNode } from '../phase1/loader';
import type { QueryIndex } from '../phase3/types';
import type { SyncReport } from '../phase2/types';
import {
  IDX_META_KEY,
  IDX_KIND_PREFIX,
  IDX_NAME_PREFIX,
} from './types';
import type { PersistentIndexMeta } from './types';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

function encodeJson(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

function decodeJson<T>(buf: Uint8Array): T {
  return JSON.parse(dec.decode(buf)) as T;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Persist a `QueryIndex` into the LSS kernel under `idx://v1/` keys.
 *
 * Layout:
 *   idx://v1/meta             → PersistentIndexMeta (JSON)
 *   idx://v1/kind/<kind>      → string[] sorted node ids (JSON)
 *   idx://v1/name/<name>      → string[] node ids (JSON)
 *
 * Existing index keys not present in the new index are tombstoned.
 */
export function saveIndex(kernel: LSSKernel, index: QueryIndex): bigint {
  // Collect existing index keys so we can tombstone stale ones.
  const existing = collectExistingIndexKeys(kernel);

  const kindKeys: string[] = [];
  const nameKeys: string[] = [];

  // Write kind buckets.
  for (const [kind, ids] of index.byKind) {
    const key = `${IDX_KIND_PREFIX}${kind}`;
    kernel.apply(key, encodeJson(Array.from(ids).sort()));
    kindKeys.push(kind);
  }

  // Write name buckets.
  for (const [name, ids] of index.byName) {
    const key = `${IDX_NAME_PREFIX}${encodeNameKey(name)}`;
    kernel.apply(key, encodeJson(ids));
    nameKeys.push(name);
  }

  // Tombstone stale keys.
  for (const oldKey of existing.kindKeys) {
    if (!index.byKind.has(oldKey)) {
      kernel.apply(`${IDX_KIND_PREFIX}${oldKey}`, null);
    }
  }
  for (const oldName of existing.nameKeys) {
    if (!index.byName.has(oldName)) {
      kernel.apply(`${IDX_NAME_PREFIX}${encodeNameKey(oldName)}`, null);
    }
  }

  // Write meta last.
  // Predict the seq this write will produce: current seq + 1 (kernel always
  // increments by exactly 1 per apply). Storing that predicted seq as `builtAt`
  // ensures isPersistedIndexCurrent() returns true immediately after this call.
  const predictedSeq = kernel.stats().seq + 1n;
  const meta: PersistentIndexMeta = {
    builtAt: String(predictedSeq),
    nodeCount: index.nodeCount,
    kindKeys,
    nameKeys,
  };
  const seq = kernel.apply(IDX_META_KEY, encodeJson(meta));
  // Sanity check: prediction must hold.
  if (seq !== predictedSeq) {
    throw new Error(`saveIndex: predicted seq ${predictedSeq} but got ${seq}`);
  }
  return seq;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Restore a `QueryIndex` from the LSS kernel.
 * Returns `null` if no index has been saved yet.
 */
export function loadIndex(kernel: LSSKernel): QueryIndex | null {
  const metaBuf = kernel.get(IDX_META_KEY);
  if (!metaBuf) return null;

  const meta = decodeJson<PersistentIndexMeta>(metaBuf);
  const byKind = new Map<string, Set<string>>();
  const byName = new Map<string, string[]>();

  for (const kind of meta.kindKeys) {
    const buf = kernel.get(`${IDX_KIND_PREFIX}${kind}`);
    if (!buf) continue;
    byKind.set(kind, new Set(decodeJson<string[]>(buf)));
  }

  for (const name of meta.nameKeys) {
    const buf = kernel.get(`${IDX_NAME_PREFIX}${encodeNameKey(name)}`);
    if (!buf) continue;
    byName.set(name, decodeJson<string[]>(buf));
  }

  return {
    byKind,
    byName,
    builtAt: BigInt(meta.builtAt),
    nodeCount: meta.nodeCount,
  };
}

// ---------------------------------------------------------------------------
// Incremental patch
// ---------------------------------------------------------------------------

/**
 * Patch an existing QueryIndex in-place (and persist the changes) using a
 * `SyncReport` from `IncrementalEngine.sync()`.
 *
 * Only the buckets touched by changed/removed files are updated;
 * untouched buckets are left as-is in the kernel.
 *
 * Returns the patched index with an updated `builtAt` sequence.
 */
export function patchIndex(
  kernel: LSSKernel,
  index: QueryIndex,
  report: SyncReport,
): QueryIndex {
  // 1. Remove stale entries for removed / changed file node ids.
  const staleFileIds = [
    ...report.removed.map(p => `file:${p}`),
    ...report.changed.map(p => `file:${p}`),
  ];

  for (const staleId of staleFileIds) {
    // Remove from byKind.
    for (const [kind, ids] of index.byKind) {
      if (ids.delete(staleId)) {
        // Persist the updated bucket.
        kernel.apply(`${IDX_KIND_PREFIX}${kind}`, encodeJson(Array.from(ids).sort()));
      }
    }
    // Remove from byName (walk all name keys for this id).
    for (const [name, ids] of index.byName) {
      const idx = ids.indexOf(staleId);
      if (idx !== -1) {
        ids.splice(idx, 1);
        if (ids.length === 0) {
          index.byName.delete(name);
          kernel.apply(`${IDX_NAME_PREFIX}${encodeNameKey(name)}`, null);
        } else {
          kernel.apply(`${IDX_NAME_PREFIX}${encodeNameKey(name)}`, encodeJson(ids));
        }
      }
    }
  }

  // 2. Add fresh entries for changed files (they were just re-parsed).
  for (const changedPath of report.changed) {
    const fileId = `file:${changedPath}`;
    const node = loadNode(kernel, fileId);
    if (!node) continue;

    // Kind bucket.
    const kindSet = index.byKind.get(node.kind) ?? new Set<string>();
    kindSet.add(fileId);
    index.byKind.set(node.kind, kindSet);
    kernel.apply(`${IDX_KIND_PREFIX}${node.kind}`, encodeJson(Array.from(kindSet).sort()));

    // Name bucket.
    const nameLower = node.name.toLowerCase();
    const nameList = index.byName.get(nameLower) ?? [];
    if (!nameList.includes(fileId)) {
      nameList.push(fileId);
      index.byName.set(nameLower, nameList);
      kernel.apply(`${IDX_NAME_PREFIX}${encodeNameKey(nameLower)}`, encodeJson(nameList));
    }
  }

  // 3. Update meta.
  const newSeq = kernel.stats().seq;
  const kindKeys = Array.from(index.byKind.keys());
  const nameKeys = Array.from(index.byName.keys());
  const meta: PersistentIndexMeta = {
    builtAt: String(newSeq),
    nodeCount: index.nodeCount + report.changed.length - staleFileIds.length / 2,
    kindKeys,
    nameKeys,
  };
  kernel.apply(IDX_META_KEY, encodeJson(meta));

  // Return a new QueryIndex object with updated sequence.
  return {
    byKind: index.byKind,
    byName: index.byName,
    builtAt: newSeq,
    nodeCount: meta.nodeCount,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeNameKey(name: string): string {
  // Percent-encode characters that would conflict with key separators.
  return encodeURIComponent(name);
}

interface ExistingIndexKeys {
  kindKeys: string[];
  nameKeys: string[];
}

function collectExistingIndexKeys(kernel: LSSKernel): ExistingIndexKeys {
  const metaBuf = kernel.get(IDX_META_KEY);
  if (!metaBuf) return { kindKeys: [], nameKeys: [] };
  try {
    const meta = decodeJson<PersistentIndexMeta>(metaBuf);
    return { kindKeys: meta.kindKeys ?? [], nameKeys: meta.nameKeys ?? [] };
  } catch {
    return { kindKeys: [], nameKeys: [] };
  }
}

/**
 * Erase all persisted index data from the kernel (useful for testing / reset).
 */
export function dropIndex(kernel: LSSKernel): void {
  const keys = collectExistingIndexKeys(kernel);
  for (const kind of keys.kindKeys) {
    kernel.apply(`${IDX_KIND_PREFIX}${kind}`, null);
  }
  for (const name of keys.nameKeys) {
    kernel.apply(`${IDX_NAME_PREFIX}${encodeNameKey(name)}`, null);
  }
  kernel.apply(IDX_META_KEY, null);
}

/**
 * Check whether the persisted index is current with the kernel.
 */
export function isPersistedIndexCurrent(kernel: LSSKernel): boolean {
  const metaBuf = kernel.get(IDX_META_KEY);
  if (!metaBuf) return false;
  try {
    const meta = decodeJson<PersistentIndexMeta>(metaBuf);
    return BigInt(meta.builtAt) === kernel.stats().seq;
  } catch {
    return false;
  }
}
