// ============================================================
// Forge — matrix expansion + substitution
// ============================================================
// Single source of truth for the matrix fan-out maths used by
// engine.ts, custom-workflow.ts, and pipeline.ts.
//
// Substitution syntax follows the GitHub Actions convention:
//   ${{ matrix.KEY }}
// ============================================================
import type { MatrixDimension, MatrixRow } from "./types";

/**
 * Expand a matrix definition into the full cartesian product.
 *
 * Example: `[{key:'node',values:['18','20']},{key:'os',values:['linux','mac']}]`
 *   → [{node:'18',os:'linux'},{node:'18',os:'mac'},{node:'20',os:'linux'},{node:'20',os:'mac'}]
 *
 * `exclude` filters out rows that match all the exclude's keys.
 * `include` adds explicit rows (already-expanded).
 */
export function expandMatrix(
  dimensions: MatrixDimension[] | undefined,
  exclude: MatrixRow[] = [],
  include: MatrixRow[] = [],
): MatrixRow[] {
  if (!dimensions || dimensions.length === 0) {
    return include.length > 0 ? include : [{}];
  }
  let rows: MatrixRow[] = [{}];
  for (const dim of dimensions) {
    const next: MatrixRow[] = [];
    for (const existing of rows) {
      for (const value of dim.values) {
        next.push({ ...existing, [dim.key]: value });
      }
    }
    rows = next;
  }
  // Apply excludes
  const filtered = rows.filter(
    (row) => !exclude.some((ex) => matchesRow(row, ex)),
  );
  // Apply includes
  return [...filtered, ...include];
}

function matchesRow(row: MatrixRow, pattern: MatrixRow): boolean {
  return Object.entries(pattern).every(([k, v]) => row[k] === v);
}

/** Substitute `${{ matrix.KEY }}` references in a string. */
export function substituteMatrix(
  template: string,
  matrix: MatrixRow,
): string {
  return template.replace(
    /\$\{\{\s*matrix\.(\w+)\s*\}\}/g,
    (_m, key: string) => (matrix[key] !== undefined ? String(matrix[key]) : ""),
  );
}

/**
 * Apply `substituteMatrix` to every string value in a record.
 * Non-string values pass through unchanged.
 */
export function substituteMatrixInRecord<
  T extends Record<string, unknown>,
>(record: T, matrix: MatrixRow): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = typeof v === "string" ? substituteMatrix(v, matrix) : v;
  }
  return out as T;
}
