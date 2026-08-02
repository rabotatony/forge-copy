// Sample project — utils/math.ts
// A small pure-math utility module to demonstrate dependency graph edges.

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

export interface MathResult {
  value: number;
  ok: boolean;
}

export function safeDivide(a: number, b: number): MathResult {
  if (b === 0) return { value: NaN, ok: false };
  return { value: a / b, ok: true };
}
