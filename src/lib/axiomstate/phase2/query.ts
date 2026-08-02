// ============================================================
// AxiomState Phase 2: Graph Query DSL
// ============================================================
import { LSSKernel } from '../phase0/kernel';
import { loadAllNodes, loadNode } from '../phase1/loader';
import { sliceForward, sliceReverse } from '../phase1/traversal';

export type Query =
  | { op: 'node'; id: string }
  | { op: 'deps'; of: string; depth?: number }
  | { op: 'rdeps'; of: string; depth?: number }
  | { op: 'kind'; kind: 'file' | 'symbol' }
  | { op: 'name'; pattern: string }
  | { op: 'and'; q: Query[] }
  | { op: 'or'; q: Query[] }
  | { op: 'not'; q: Query };

export function evaluate(kernel: LSSKernel, query: Query): Set<string> {
  switch (query.op) {
    case 'node': {
      const found = loadNode(kernel, query.id) !== undefined;
      return found ? new Set([query.id]) : new Set();
    }
    case 'deps': {
      const slice = sliceForward(kernel, query.of, query.depth ?? Infinity);
      return new Set(slice.nodes.keys());
    }
    case 'rdeps': {
      const slice = sliceReverse(kernel, query.of, query.depth ?? Infinity);
      return new Set(slice.nodes.keys());
    }
    case 'kind': {
      const all = loadAllNodes(kernel);
      const result = new Set<string>();
      for (const [id, node] of all) {
        if (node.kind === query.kind) result.add(id);
      }
      return result;
    }
    case 'name': {
      const all = loadAllNodes(kernel);
      const result = new Set<string>();
      const re = globToRegex(query.pattern);
      for (const [id, node] of all) {
        if (re.test(node.name)) result.add(id);
      }
      return result;
    }
    case 'and': {
      if (query.q.length === 0) return new Set();
      const [first, ...rest] = query.q;
      let result = evaluate(kernel, first!);
      for (const q of rest) {
        const next = evaluate(kernel, q);
        result = intersect(result, next);
      }
      return result;
    }
    case 'or': {
      const result = new Set<string>();
      for (const q of query.q) {
        for (const id of evaluate(kernel, q)) result.add(id);
      }
      return result;
    }
    case 'not': {
      const all = loadAllNodes(kernel);
      const excluded = evaluate(kernel, query.q);
      const result = new Set<string>();
      for (const id of all.keys()) {
        if (!excluded.has(id)) result.add(id);
      }
      return result;
    }
  }
}

export function parseQuery(input: string): Query {
  input = input.trim();
  if (input.startsWith('and(')) return parseCompound(input, 'and');
  if (input.startsWith('or(')) return parseCompound(input, 'or');
  if (input.startsWith('not(')) {
    const inner = unwrap(input, 'not');
    return { op: 'not', q: parseQuery(inner) };
  }
  if (input.startsWith('node(')) {
    const inner = unwrap(input, 'node');
    return { op: 'node', id: unquote(inner) };
  }
  if (input.startsWith('deps(')) {
    const inner = unwrap(input, 'deps');
    const parts = splitTopLevel(inner).map(s => s.trim());
    const of = unquote(parts[0]!);
    if (parts[1]) return { op: 'deps', of, depth: parseInt(parts[1], 10) };
    return { op: 'deps', of };
  }
  if (input.startsWith('rdeps(')) {
    const inner = unwrap(input, 'rdeps');
    const parts = splitTopLevel(inner).map(s => s.trim());
    const of = unquote(parts[0]!);
    if (parts[1]) return { op: 'rdeps', of, depth: parseInt(parts[1], 10) };
    return { op: 'rdeps', of };
  }
  if (input.startsWith('kind:')) {
    const kind = input.slice('kind:'.length).trim();
    if (kind !== 'file' && kind !== 'symbol') throw new Error(`Unknown kind: ${kind}`);
    return { op: 'kind', kind };
  }
  if (input.startsWith('name:')) {
    return { op: 'name', pattern: input.slice('name:'.length).trim() };
  }
  return { op: 'node', id: unquote(input) };
}

function unwrap(input: string, prefix: string): string {
  const start = prefix.length + 1;
  if (!input.endsWith(')')) throw new Error(`Unbalanced query: ${input}`);
  return input.slice(start, -1).trim();
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of input) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
    else { current += ch; }
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

function parseCompound(input: string, op: 'and' | 'or'): Query {
  const inner = unwrap(input, op);
  const parts = splitTopLevel(inner);
  return { op, q: parts.map(p => parseQuery(p.trim())) };
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

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const id of a) if (b.has(id)) result.add(id);
  return result;
}
