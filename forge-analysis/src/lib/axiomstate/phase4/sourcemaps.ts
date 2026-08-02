// ============================================================
// AxiomState Phase 4: Source Map Generation
// ============================================================
// Produces V3 source maps for TransformedBundle outputs.
//
// Algorithm:
//   1. Count output lines contributed by each bundle entry.
//   2. For each entry, map every input line to the corresponding
//      output line (identity mapping — one output line per input line).
//   3. Encode with VLQ and assemble a standard V3 JSON object.
//
// No external dependencies. The VLQ encoder is self-contained.
// ============================================================

import type { TransformedBundle } from '../phase3/types';
import type { SourceMapV3, SourceMappedBundle, SourceMappedEntry, SourceMapOptions } from './types';

// ---------------------------------------------------------------------------
// VLQ encoding (Base64 VLQ as specified in the source-map spec)
// ---------------------------------------------------------------------------

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_CONTINUATION = 0x20;

function vlqEncode(value: number): string {
  // Convert to sign-magnitude representation.
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

// ---------------------------------------------------------------------------
// Mapping generation
// ---------------------------------------------------------------------------

const dec = new TextDecoder();

/**
 * Count the number of newline characters in a Uint8Array.
 */
function countLines(content: Uint8Array): number {
  let count = 1;  // at least 1 line
  for (let i = 0; i < content.byteLength; i++) {
    if (content[i] === 0x0a) count++;  // 0x0a = '\n'
  }
  // Trim trailing empty line.
  if (content.byteLength > 0 && content[content.byteLength - 1] === 0x0a) count--;
  return Math.max(count, 1);
}

/**
 * Generate a "source segment" for a single input line mapped to an output line.
 *
 * Fields (VLQ encoded, all deltas):
 *   [outputCol, sourceIndex, inputLine, inputCol]
 *
 * Since we emit one mapping per output line and reset column to 0 on each line,
 * the outputCol is always 0 and inputCol is always 0.
 */
function buildMappingsForEntry(
  inputLineCount: number,
  sourceIndex: number,
  outputLineOffset: number,
  prevSourceLine: { value: number },
  prevSourceIndex: { value: number },
): string {
  const groups: string[] = [];

  for (let inputLine = 0; inputLine < inputLineCount; inputLine++) {
    // Fields: [genCol=0, sources delta, source line delta, source col=0]
    // Output line = outputLineOffset + inputLine (implicit from ';' separators)
    const sourceIndexDelta = sourceIndex - prevSourceIndex.value;
    const sourceLineDelta = inputLine - prevSourceLine.value;
    const seg = vlqEncodeFields([0, sourceIndexDelta, sourceLineDelta, 0]);
    groups.push(seg);

    // Update prevs for next entry's delta calculation.
    prevSourceIndex.value = sourceIndex;
    prevSourceLine.value = inputLine;
  }

  // Separator lines (the `// --- <path> ---` lines we add in concatenate())
  // are unmapped — emit an empty group.
  if (outputLineOffset > 0) {
    // Insert a sentinel for the separator line before this entry.
    // Already accounted for in outputLineOffset — nothing to do here.
  }

  return groups.join(';');
}

// ---------------------------------------------------------------------------
// Per-entry source map
// ---------------------------------------------------------------------------

function buildEntrySourceMap(
  entry: { path: string; content: Uint8Array },
  sourceRoot: string | undefined,
  inlineSources: boolean,
): SourceMapV3 {
  const lineCount = countLines(entry.content);
  // For a single-entry map, all lines map to source index 0.
  const prevSourceIndex = { value: 0 };
  const prevSourceLine = { value: 0 };
  const mappings = buildMappingsForEntry(lineCount, 0, 0, prevSourceLine, prevSourceIndex);

  const map: SourceMapV3 = {
    version: 3,
    sources: [entry.path],
    names: [],
    mappings,
  };
  if (sourceRoot !== undefined) map.sourceRoot = sourceRoot;
  if (inlineSources) {
    map.sourcesContent = [dec.decode(entry.content)];
  }
  return map;
}

// ---------------------------------------------------------------------------
// Bundle source map
// ---------------------------------------------------------------------------

/**
 * Generate a full V3 source map for a `TransformedBundle` produced by
 * `bundleWithTransforms`.
 *
 * The concatenated output format is:
 *   <content of file 0>
 *   // --- src/utils.ts ---      ← separator (1 line)
 *   <content of file 1>
 *   // --- src/index.ts ---
 *   ...
 */
export function generateBundleSourceMap(
  bundle: TransformedBundle,
  options: SourceMapOptions = {},
): SourceMappedBundle {
  const inlineSources = options.inlineSources ?? true;
  const sources: string[] = [];
  const sourcesContent: Array<string | null> = [];
  const allGroups: string[] = [];

  // One separator line before each entry after the first.
  const prevSourceIndex = { value: 0 };
  const prevSourceLine = { value: 0 };

  let outputLine = 0;
  const mappedEntries: SourceMappedEntry[] = [];

  for (let i = 0; i < bundle.entries.length; i++) {
    const entry = bundle.entries[i]!;
    const sourceIndex = i;
    sources.push(entry.path);
    sourcesContent.push(inlineSources ? dec.decode(entry.content) : null);

    // The separator line (added by concatenate()) is one output line.
    // We mark it unmapped.
    if (i > 0) {
      allGroups.push('');  // empty → no mappings on separator line
      outputLine++;
    }

    const lineCount = countLines(entry.content);
    const entryOutputOffset = outputLine;

    // Reset per-source-index tracking for each new source.
    prevSourceIndex.value = sourceIndex > 0 ? sourceIndex - 1 : 0;
    prevSourceLine.value = 0;

    const entryGroups: string[] = [];
    for (let ln = 0; ln < lineCount; ln++) {
      const sourceIndexDelta = sourceIndex - prevSourceIndex.value;
      const sourceLineDelta = ln - prevSourceLine.value;
      entryGroups.push(vlqEncodeFields([0, sourceIndexDelta, sourceLineDelta, 0]));
      prevSourceIndex.value = sourceIndex;
      prevSourceLine.value = ln;
      allGroups.push(entryGroups[entryGroups.length - 1]!);
      outputLine++;
    }

    const entryMap = buildEntrySourceMap(entry, options.sourceRoot, inlineSources);

    mappedEntries.push({
      ...entry,
      outputLines: lineCount,
      outputLineOffset: entryOutputOffset,
      entryMap,
    });
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

  return {
    order: bundle.order,
    entries: mappedEntries,
    cycles: bundle.cycles,
    bundleMap,
  };
}

/**
 * Emit a concatenated bundle + inline source-map comment.
 * Appends `//# sourceMappingURL=data:application/json;base64,...` at the end.
 */
export function concatenateWithSourceMap(
  bundle: SourceMappedBundle,
): { output: Uint8Array; map: SourceMapV3 } {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();

  for (let i = 0; i < bundle.entries.length; i++) {
    const e = bundle.entries[i]!;
    if (i > 0) parts.push(enc.encode(`\n// --- ${e.path} ---\n`));
    parts.push(e.content);
  }

  const mapJson = JSON.stringify(bundle.bundleMap);
  const mapB64 = Buffer.from(mapJson, 'utf-8').toString('base64');
  parts.push(enc.encode(`\n//# sourceMappingURL=data:application/json;base64,${mapB64}\n`));

  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const output = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { output.set(p, off); off += p.byteLength; }

  return { output, map: bundle.bundleMap };
}
