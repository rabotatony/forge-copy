// Sample project — utils/strings.ts
// String utilities consumed by the index module.

export function upper(s: string): string {
  return s.toUpperCase();
}

export function lower(s: string): string {
  return s.toLowerCase();
}

export function reverse(s: string): string {
  return s.split('').reverse().join('');
}

export function pad(s: string, n: number, ch = '0'): string {
  return s.length >= n ? s : ch.repeat(n - s.length) + s;
}
