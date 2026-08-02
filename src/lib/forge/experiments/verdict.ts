// ============================================================
// Forge — Experiments Lab verdict helpers
// ============================================================
// The Experiments Lab computes a per-run verdict:
//   - BREAKTHROUGH  — the experiment produced a strictly better artifact
//                     (e.g. an AI-generated script ≥1.2× faster with
//                     identical output, cyclomatic complexity reduced by
//                     >30%, a new test suite added, a security fix landed
//                     via PR).
//   - NO_CHANGE     — the experiment produced a comparable artifact but no
//                     clear improvement (e.g. <1.2× speedup, equivalent
//                     complexity).
//   - REGRESSION    — the experiment produced a worse artifact (slower,
//                     more complex, broke tests, generated invalid code,
//                     or threw an exception).
//
// Each experiment's run() function computes its own verdict inline — the
// thresholds differ per experiment (speedup ratio for self-optimizing,
// score > 0.8 for tournament, test-pass count for capability-synthesis,
// PR-opened for product-* breakthroughs, etc.). This module holds the
// small metric helpers that experiments use to compute the numbers that
// feed into those verdicts. There is intentionally no central
// `decideVerdict()` — the verdict logic lives with each experiment
// because the threshold semantics are experiment-specific.
// ============================================================

/** Median of a list of numbers. Used to summarise 3-run timings so a
 *  single slow run (e.g. JIT warmup) doesn't dominate the verdict. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Estimate cyclomatic complexity by counting branching keywords:
 * if, elif, for, while, and, or, except. Each adds 1 to the base complexity of 1.
 */
export function measureComplexity(code: string): number {
  let complexity = 1;
  const keywords = /\b(if|elif|for|while|and|or|except)\b/g;
  const matches = code.match(keywords);
  if (matches) complexity += matches.length;
  return complexity;
}

/**
 * Estimate the maximum nesting depth of a Python source string by counting
 * indentation levels. Each 4-space indent (or tab) at the start of a line
 * that is deeper than the previous non-blank line's indent counts as a level.
 * Returns the deepest indentation seen, in units of 4 spaces.
 */
export function measureMaxNesting(code: string): number {
  let maxDepth = 0;
  for (const line of code.split('\n')) {
    if (!line.trim()) continue;
    const leading = line.match(/^(\t|    )*/)?.[0] ?? '';
    // Convert tabs to 4-space units, then count groups of 4.
    const spaces = leading.replace(/\t/g, '    ');
    const depth = Math.floor(spaces.length / 4);
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth;
}
