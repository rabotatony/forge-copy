// ============================================================
// AxiomState Phase 5: Incremental Source-Map Builder
// ============================================================
// Re-bundles a forward dependency slice and produces a V3 source
// map, re-using per-entry VLQ mappings from a previous bundle when
// the entry's path AND content hash are unchanged.
//
// Algorithm:
//   1. Compute the forward slice from `startId` (phase1/traversal).
//   2. Bundle with optional transforms (phase3/transform).
//   3. If a `prevBundleId` was supplied, load its stored source map
//      and index entries by path. For each new entry whose content
//      hash matches the previous content hash, copy that entry's
//      per-line VLQ groups verbatim (only the FIRST group of each
//      entry is regenerated, because its sourceIndex-delta depends
//      on the new bundle position).
//   4. For changed / new entries, regenerate per-line VLQ groups
//      from scratch.
//   5. Concatenate the unified output via phase4/concatenateWithSourceMap.
//   6. Save the new source map under a fresh bundle id.
//
// The "incremental" optimisation is that unchanged entries skip
// VLQ re-encoding for their per-line groups (everything except the
// first). Because the per-entry format is deterministic (first group
// encodes `[0, sourceIndexDelta, 0, 0]`, remaining groups encode
// `[0, 0, 1, 0]`), reuse is safe as long as the line count is
// preserved — which the content-hash check guarantees.
//
// Server-side only — uses node:crypto, LSSKernel, and phase1-4 helpers.
// ============================================================

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { LSSKernel } from '../phase0/kernel';
import { sliceForward } from '../phase1/traversal';
import type { TransformFn } from '../phase3/types';
import { bundleWithTransforms } from '../phase3/transform';
import {
  generateBundleSourceMap,
  concatenateWithSourceMap,
} from '../phase4/sourcemaps';
import type {
  SourceMapV3,
  SourceMappedBundle,
  SourceMapOptions,
} from '../phase4/types';
import { saveSourceMap, loadSourceMap } from './persistent-sourcemaps';
import type { IncrementalSourceMapResult } from './types';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// VLQ encoding (mirrors phase4/sourcemaps.ts — kept local to avoid widening
// the phase4 public surface).
// ---------------------------------------------------------------------------

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_CONTINUATION = 0x20;

function vlqEncode(value: number): string {
  let signedVal = value < 0 ? (-value << 1) | 1 : value << 1;
  let result = '';
  do {
    let digit = signedVal & 0x1F;
    signedVal >>>= 5;
    if (signedVal > 0) digit |= VLQ_CONTINUATION;
    result += BASE64_CHARS[digit]!;
  } while (signedVal > 0);
  return result;
}

function vlqEncodeFields(fields: number[]): string {
  return fields.map(vlqEncode).join('');
}

// The repeating per-line group for a continued entry: [0, 0, 1, 0].
const REPEATING_GROUP = vlqEncodeFields([0, 0, 1, 0]);

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of lines contributed by `content`, mirroring
 * phase4/sourcemaps.ts `countLines`. A trailing newline is treated as
 * the end of the last line, not as the start of a new (empty) line.
 */
function countLines(content: Uint8Array): number {
  let count = 1;
  for (let i = 0; i < content.byteLength; i++) {
    if (content[i] === 0x0a) count++;
  }
  if (content.byteLength > 0 && content[content.byteLength - 1] === 0x0a) count--;
  return Math.max(count, 1);
}

function sha256Hex(buf: Uint8Array | Buffer | string): string {
  return createHash('sha256')
    .update(typeof buf === 'string' ? Buffer.from(buf, 'utf-8') : buf)
    .digest('hex');
}

/**
 * Encode the FIRST per-line VLQ group for an entry at bundle position
 * `sourceIndex`. Fields: [genCol=0, sourceIndexDelta, sourceLineDelta=0, sourceCol=0].
 *
 * `sourceIndexDelta` is 1 when `sourceIndex > 0` (because the unified
 * source-map encoder resets the previous source index to `sourceIndex - 1`
 * at the start of each entry, so the first line's delta is always 1), and 0
 * for the very first entry.
 */
function encodeFirstGroup(sourceIndex: number): string {
  const sourceIndexDelta = sourceIndex > 0 ? 1 : 0;
  return vlqEncodeFields([0, sourceIndexDelta, 0, 0]);
}

// ---------------------------------------------------------------------------
// Previous-bundle index
// ---------------------------------------------------------------------------

interface PreviousBundleIndex {
  /** Path -> entry index in the previous bundle. */
  pathToIndex: Map<string, number>;
  /** Per-entry line counts (computed from sourcesContent). */
  lineCounts: number[];
  /** Per-entry start offsets within `groups` (the first group of each entry). */
  entryStarts: number[];
  /** All groups (split from bundleMap.mappings). */
  groups: string[];
  /** Per-entry content hash (hex), or null if not computable. */
  contentHashes: Array<string | null>;
}

/**
 * Build a reuse index from a previously stored source map.
 * Returns null when the previous map cannot be used for reuse (e.g.
 * sourcesContent is missing, or the mappings field is malformed).
 */
function buildPreviousBundleIndex(
  sourceMap: SourceMapV3,
): PreviousBundleIndex | null {
  if (!sourceMap.sourcesContent) return null;
  if (sourceMap.sourcesContent.length !== sourceMap.sources.length) return null;

  const lineCounts: number[] = [];
  const contentHashes: Array<string | null> = [];

  for (let i = 0; i < sourceMap.sources.length; i++) {
    const content = sourceMap.sourcesContent[i];
    if (content === null || content === undefined) {
      lineCounts.push(0);
      contentHashes.push(null);
      continue;
    }
    const bytes = enc.encode(content);
    lineCounts.push(countLines(bytes));
    contentHashes.push(sha256Hex(content));
  }

  const groups = sourceMap.mappings.length === 0 ? [] : sourceMap.mappings.split(';');
  const entryStarts: number[] = [];
  let cursor = 0;
  for (let i = 0; i < sourceMap.sources.length; i++) {
    entryStarts.push(cursor);
    if (i > 0) cursor += 1; // separator empty group
    cursor += lineCounts[i] ?? 0;
  }

  const pathToIndex = new Map<string, number>();
  for (let i = 0; i < sourceMap.sources.length; i++) {
    pathToIndex.set(sourceMap.sources[i]!, i);
  }

  return { pathToIndex, lineCounts, entryStarts, groups, contentHashes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IncrementalBundleOptions extends SourceMapOptions {
  /** Previous bundle id whose source map should be reused for unchanged entries. */
  prevBundleId?: string;
  /** Transforms to apply to each entry before bundling. */
  transforms?: TransformFn[];
}

/**
 * Build a bundle + V3 source map for the forward dependency slice
 * starting at `startId`, reusing per-entry VLQ mappings from a
 * previous bundle where possible.
 *
 * @param kernel   The LSS kernel.
 * @param startId  Node id to slice forward from (e.g. `file:src/index.ts`).
 * @param options  Optional prev bundle id, transforms, and source-map options.
 */
export function incrementalBundleWithSourceMap(
  kernel: LSSKernel,
  startId: string,
  options: IncrementalBundleOptions = {},
): IncrementalSourceMapResult {
  const inlineSources = options.inlineSources ?? true;
  const transforms = options.transforms ?? [];

  // 1. Forward slice.
  const slice = sliceForward(kernel, startId);
  const fileIds = Array.from(slice.nodes.keys());

  // 2. Bundle (with optional transforms).
  const bundle = bundleWithTransforms(kernel, fileIds, { transforms });

  // 3. Load previous source map (if any) and build a reuse index.
  let prevIndex: PreviousBundleIndex | null = null;
  if (options.prevBundleId) {
    const prevStored = loadSourceMap(kernel, options.prevBundleId);
    if (prevStored) {
      prevIndex = buildPreviousBundleIndex(prevStored.sourceMap);
    }
  }

  // 4. Build the unified bundle map, reusing per-entry groups where possible.
  const sources: string[] = [];
  const sourcesContent: Array<string | null> = [];
  const allGroups: string[] = [];
  let reusedEntries = 0;
  let rebuiltEntries = 0;

  for (let i = 0; i < bundle.entries.length; i++) {
    const entry = bundle.entries[i]!;
    const sourceIndex = i;
    sources.push(entry.path);
    sourcesContent.push(inlineSources ? dec.decode(entry.content) : null);

    // Separator line (one empty group) for every entry except the first.
    if (i > 0) allGroups.push('');

    const lineCount = countLines(entry.content);
    const entryHash = sha256Hex(Buffer.from(entry.content));

    // Try to reuse per-entry groups from the previous bundle.
    let reused = false;
    if (prevIndex) {
      const prevIdx = prevIndex.pathToIndex.get(entry.path);
      if (
        prevIdx !== undefined &&
        prevIdx < prevIndex.lineCounts.length &&
        prevIndex.lineCounts[prevIdx] === lineCount &&
        prevIndex.contentHashes[prevIdx] === entryHash
      ) {
        const prevStart = prevIndex.entryStarts[prevIdx]!;
        // Regenerate the first group (its sourceIndex-delta depends on the
        // new bundle position); copy the remaining (lineCount - 1) groups
        // verbatim from the previous bundle.
        allGroups.push(encodeFirstGroup(sourceIndex));
        for (let ln = 1; ln < lineCount; ln++) {
          const prevGroup = prevIndex.groups[prevStart + ln];
          allGroups.push(prevGroup ?? REPEATING_GROUP);
        }
        reused = true;
        reusedEntries++;
      }
    }

    if (!reused) {
      // Rebuild per-entry groups from scratch for this entry.
      allGroups.push(encodeFirstGroup(sourceIndex));
      for (let ln = 1; ln < lineCount; ln++) {
        allGroups.push(REPEATING_GROUP);
      }
      rebuiltEntries++;
    }
  }

  const bundleMap: SourceMapV3 = {
    version: 3,
    sources,
    names: [],
    mappings: allGroups.join(';'),
  };
  if (options.outputFile) bundleMap.file = options.outputFile;
  if (options.sourceRoot) bundleMap.sourceRoot = options.sourceRoot;
  if (inlineSources) bundleMap.sourcesContent = sourcesContent;

  // 5. Concatenate the output (with separator lines + sourceMappingURL
  //    comment) via the phase4 helper. We wrap our bundleMap in a
  //    SourceMappedBundle shell; concatenateWithSourceMap only reads
  //    entries[*].path, entries[*].content, and bundleMap.
  const mappedBundle: SourceMappedBundle = {
    order: bundle.order,
    entries: bundle.entries.map((e) => ({
      ...e,
      outputLines: countLines(e.content),
      outputLineOffset: 0,
      entryMap: {
        version: 3,
        sources: [e.path],
        names: [],
        mappings: '',
      },
    })),
    cycles: bundle.cycles,
    bundleMap,
  };
  const { output } = concatenateWithSourceMap(mappedBundle);

  // 6. Save the new source map under a fresh bundle id.
  const ts = Date.now();
  const shortHash = sha256Hex(output).slice(0, 8);
  const newBundleId = `bundle-${ts}-${shortHash}`;
  saveSourceMap(kernel, newBundleId, bundleMap, output.byteLength);

  return {
    bundleId: newBundleId,
    output,
    sourceMap: bundleMap,
    reusedEntries,
    rebuiltEntries,
    totalEntries: bundle.entries.length,
  };
}

// ---------------------------------------------------------------------------
// Re-export for callers that want the non-incremental builder too
// ---------------------------------------------------------------------------

export { generateBundleSourceMap, concatenateWithSourceMap } from '../phase4/sourcemaps';
