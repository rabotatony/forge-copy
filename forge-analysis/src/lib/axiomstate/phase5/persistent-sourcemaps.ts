// ============================================================
// AxiomState Phase 5: Persistent Source Maps
// ============================================================
// Stores generated V3 source maps under `sm://v1/<bundleId>` keys
// in the LSSKernel, with a `sm://v1/__meta__` aggregate key listing
// all known bundle ids.
//
// Bundle ids may contain slashes (e.g. `bundle-2024-01-01/abc`); they
// are percent-encoded for the kernel key suffix so the prefix scan
// remains unambiguous.
//
// Server-side only — uses TextEncoder/TextDecoder and the LSSKernel.
// ============================================================

import { LSSKernel } from '../phase0/kernel';
import type { SourceMapV3 } from '../phase4/types';
import {
  SM_PREFIX,
  SM_META_KEY,
  type PersistentSourceMapMeta,
  type StoredSourceMap,
} from './types';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Key encoding
// ---------------------------------------------------------------------------

/**
 * Percent-encode a bundle id for use as a kernel key suffix.
 *
 * Bundle ids are arbitrary strings; encoding them ensures that `/`
 * and other special characters do not interfere with prefix scans.
 */
function encodeBundleId(bundleId: string): string {
  return encodeURIComponent(bundleId);
}

/** Inverse of {@link encodeBundleId}. */
function decodeBundleId(encoded: string): string {
  return decodeURIComponent(encoded);
}

/** Construct the kernel key for a given bundle id. */
function sourceMapKey(bundleId: string): string {
  return `${SM_PREFIX}${encodeBundleId(bundleId)}`;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function encodeJson(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

function decodeJson<T>(buf: Uint8Array): T {
  return JSON.parse(dec.decode(buf)) as T;
}

// ---------------------------------------------------------------------------
// Meta read / write
// ---------------------------------------------------------------------------

function readMeta(kernel: LSSKernel): PersistentSourceMapMeta {
  const buf = kernel.get(SM_META_KEY);
  if (!buf) return { bundleIds: [], savedAt: '0', count: 0 };
  try {
    return decodeJson<PersistentSourceMapMeta>(buf);
  } catch {
    return { bundleIds: [], savedAt: '0', count: 0 };
  }
}

/**
 * Persist the meta key. We predict the seq this write will receive
 * (current seq + 1, since kernel.apply increments by exactly 1) so
 * `savedAt` matches the actual seq at write time.
 */
function writeMeta(kernel: LSSKernel, bundleIds: string[]): bigint {
  const predictedSeq = kernel.stats().seq + 1n;
  const meta: PersistentSourceMapMeta = {
    bundleIds: dedupeSorted(bundleIds).sort(),
    savedAt: String(predictedSeq),
    count: bundleIds.length,
  };
  const seq = kernel.apply(SM_META_KEY, encodeJson(meta));
  if (seq !== predictedSeq) {
    throw new Error(
      `writeMeta: predicted seq ${predictedSeq} but got ${seq}`,
    );
  }
  return seq;
}

function dedupeSorted(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a generated source map for `bundleId` under `sm://v1/<bundleId>`,
 * and refresh the `__meta__` key with the new bundle id list.
 *
 * @returns The kernel seq at which the source map was written.
 */
export function saveSourceMap(
  kernel: LSSKernel,
  bundleId: string,
  sourceMap: SourceMapV3,
  outputBytes: number,
): bigint {
  const predictedSeq = kernel.stats().seq + 1n;
  const stored: StoredSourceMap = {
    bundleId,
    sourceMap,
    savedAt: String(predictedSeq),
    outputBytes,
    sources: sourceMap.sources.slice(),
  };
  const key = sourceMapKey(bundleId);
  const seq = kernel.apply(key, encodeJson(stored));
  if (seq !== predictedSeq) {
    throw new Error(
      `saveSourceMap: predicted seq ${predictedSeq} but got ${seq}`,
    );
  }

  // Update meta with the new bundle id.
  const meta = readMeta(kernel);
  const ids = meta.bundleIds.filter(id => id !== bundleId);
  ids.push(bundleId);
  // writeMeta performs its own apply(), so this is the second kernel write.
  writeMeta(kernel, ids);

  // Return the seq of the source-map write itself (not the meta write).
  return seq;
}

/**
 * Load a previously-stored source map by bundle id.
 * Returns `null` if the bundle id is not stored (or has been tombstoned).
 */
export function loadSourceMap(
  kernel: LSSKernel,
  bundleId: string,
): StoredSourceMap | null {
  const buf = kernel.get(sourceMapKey(bundleId));
  if (!buf) return null;
  try {
    return decodeJson<StoredSourceMap>(buf);
  } catch {
    return null;
  }
}

/**
 * List all stored bundle ids (sorted, deduped).
 * Reads from the `__meta__` key for O(1) lookup.
 */
export function listSourceMaps(kernel: LSSKernel): string[] {
  return readMeta(kernel).bundleIds.slice();
}

/**
 * Remove a single stored source map by bundle id.
 * Tombstones the per-bundle key and updates the meta list.
 */
export function dropSourceMap(kernel: LSSKernel, bundleId: string): void {
  const key = sourceMapKey(bundleId);
  if (kernel.get(key) === undefined) return;
  kernel.apply(key, null);

  const meta = readMeta(kernel);
  const ids = meta.bundleIds.filter(id => id !== bundleId);
  writeMeta(kernel, ids);
}

/**
 * Remove every stored source map plus the `__meta__` aggregate key.
 */
export function dropAllSourceMaps(kernel: LSSKernel): void {
  const meta = readMeta(kernel);
  for (const id of meta.bundleIds) {
    kernel.apply(sourceMapKey(id), null);
  }
  // Tombstone meta last.
  kernel.apply(SM_META_KEY, null);
}

// ---------------------------------------------------------------------------
// Internals exported for diagnostics / tests
// ---------------------------------------------------------------------------

/** Read the current persistent source-map meta (or an empty default). */
export function getSourceMapMeta(kernel: LSSKernel): PersistentSourceMapMeta {
  return readMeta(kernel);
}

/**
 * Enumerate every stored source map by walking live `sm://v1/` keys.
 * Slower than {@link listSourceMaps} but useful for sanity checks.
 */
export function enumerateSourceMaps(kernel: LSSKernel): string[] {
  const ids: string[] = [];
  for (const key of kernel.keys()) {
    if (!key.startsWith(SM_PREFIX)) continue;
    if (key === SM_META_KEY) continue;
    const encoded = key.slice(SM_PREFIX.length);
    try {
      ids.push(decodeBundleId(encoded));
    } catch {
      // Skip malformed keys.
    }
  }
  return ids.sort();
}
