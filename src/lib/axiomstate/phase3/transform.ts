// ============================================================
// AxiomState Phase 3: Code Transform Pipeline
// ============================================================
import { LSSKernel } from '../phase0/kernel';
import { evaluate } from '../phase2/query';
import { bundleFiles } from '../phase2/bundle';
import { parseQuery } from '../phase2/query';
import type { TransformContext, TransformFn, TransformPipelineOptions, TransformedBundle } from './types';

// ---------------------------------------------------------------------------
// Pipeline executor
// ---------------------------------------------------------------------------

/**
 * Run a sequence of transforms over a single file's content.
 * Transforms are applied in order; each receives the output of the previous.
 */
export function applyTransforms(
  ctx: TransformContext,
  transforms: TransformFn[],
): Uint8Array {
  let content = ctx.content;
  for (const transform of transforms) {
    const result = transform({
      path: ctx.path,
      content,
      sourceText: new TextDecoder().decode(content),
    });
    content = result.content;
  }
  return content;
}

/**
 * Bundle a set of file ids, then run each entry through the transform pipeline.
 */
export function bundleWithTransforms(
  kernel: LSSKernel,
  fileIds: Set<string> | string[],
  options: TransformPipelineOptions,
): TransformedBundle {
  const bundle = bundleFiles(kernel, fileIds);
  const entries: TransformedBundle['entries'] = bundle.entries.map(entry => {
    const ctx: TransformContext = {
      path: entry.path,
      content: entry.content,
      sourceText: new TextDecoder().decode(entry.content),
    };
    const transformed = applyTransforms(ctx, options.transforms);
    return {
      id: entry.id,
      path: entry.path,
      content: transformed,
      transformed: !uint8ArrayEqual(entry.content, transformed),
    };
  });
  return { order: bundle.order, entries, cycles: bundle.cycles };
}

/**
 * Bundle a forward dependency slice from startId and run transforms.
 */
export function bundleFromSlice(
  kernel: LSSKernel,
  startId: string,
  options: TransformPipelineOptions,
): TransformedBundle {
  const slice = evaluate(kernel, parseQuery(`deps(${startId})`));
  return bundleWithTransforms(kernel, slice, options);
}

// ---------------------------------------------------------------------------
// Built-in transforms
// ---------------------------------------------------------------------------

/**
 * Strip TypeScript type annotations using regex heuristics.
 * This is a lightweight, deterministic transform — not a full TS compiler.
 * For production use, wire in the real TS compiler via a custom TransformFn.
 */
export const stripTypeAnnotations: TransformFn = (ctx): { content: Uint8Array } => {
  let text = ctx.sourceText;

  // Remove import type declarations.
  text = text.replace(/^import\s+type\s+.*?;?\s*$/gm, '');

  // Remove inline type annotations: `: Type` before `=`, `,`, `)`, `{`, or end of line.
  // This is intentionally conservative — it only removes simple `param: T` patterns.
  text = text.replace(/:\s*[A-Z][A-Za-z0-9_<>, \[\]|&]*/g, (match, offset, str) => {
    // Don't strip inside string literals (crude check).
    const before = str.slice(0, offset);
    const singleQuotes = (before.match(/'/g) ?? []).length;
    const doubleQuotes = (before.match(/"/g) ?? []).length;
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) return match;
    return '';
  });

  // Remove export type aliases.
  text = text.replace(/^export\s+type\s+\w+.*?;?\s*$/gm, '');

  // Remove interface declarations (single-line).
  text = text.replace(/^export\s+interface\s+\w+\s*\{[^}]*\}\s*$/gm, '');

  return { content: new TextEncoder().encode(text) };
};

/**
 * Add a banner comment at the top of each file.
 */
export function bannerTransform(banner: string): TransformFn {
  return (ctx): { content: Uint8Array } => {
    const text = `// ${banner}\n${ctx.sourceText}`;
    return { content: new TextEncoder().encode(text) };
  };
}

/**
 * Add a footer comment at the bottom of each file.
 */
export function footerTransform(footer: string): TransformFn {
  return (ctx): { content: Uint8Array } => {
    const text = `${ctx.sourceText}\n// ${footer}`;
    return { content: new TextEncoder().encode(text) };
  };
}

/**
 * Replace patterns in source text (deterministic find-replace).
 */
export function replaceTransform(
  replacements: Array<{ from: string | RegExp; to: string }>,
): TransformFn {
  return (ctx): { content: Uint8Array } => {
    let text = ctx.sourceText;
    for (const { from, to } of replacements) {
      if (typeof from === 'string') {
        text = text.split(from).join(to);
      } else {
        text = text.replace(from, to);
      }
    }
    return { content: new TextEncoder().encode(text) };
  };
}

/**
 * Minify whitespace (strip comments and collapse blank lines).
 */
export const minifyWhitespace: TransformFn = (ctx): { content: Uint8Array } => {
  let text = ctx.sourceText;
  // Remove single-line comments (not URLs).
  text = text.replace(/(?<![:"'])\/\/(?!\/)[^\n]*/g, '');
  // Remove multi-line comments.
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  // Collapse multiple blank lines to one.
  text = text.replace(/\n{3,}/g, '\n\n');
  return { content: new TextEncoder().encode(text) };
};

/**
 * Concatenate all bundle entries into a single output buffer,
 * separated by a file-path comment.
 */
export function concatenate(bundle: TransformedBundle): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of bundle.entries) {
    const header = `\n// --- ${entry.path} ---\n`;
    parts.push(new TextEncoder().encode(header));
    parts.push(entry.content);
  }
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uint8ArrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
