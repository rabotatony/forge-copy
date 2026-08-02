import { LSSKernel } from '../phase0/kernel';
import { KEY_PREFIXES } from './types';
import type { GraphNode, GraphMeta } from './types';

export function loadNode(kernel: LSSKernel, id: string): GraphNode | undefined {
  const raw = kernel.get(`${KEY_PREFIXES.node}${id}`);
  if (raw === undefined) return undefined;
  const payload = JSON.parse(new TextDecoder().decode(raw)) as { kind: 'file' | 'symbol'; name: string; deps: string[] };
  return { id, kind: payload.kind, name: payload.name, payload: raw, deps: payload.deps };
}

export function loadAllNodes(kernel: LSSKernel): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  for (const key of kernel.keys()) {
    if (!key.startsWith(KEY_PREFIXES.node)) continue;
    const id = key.slice(KEY_PREFIXES.node.length);
    const node = loadNode(kernel, id);
    if (node) map.set(id, node);
  }
  return map;
}

export function loadMeta(kernel: LSSKernel): GraphMeta | undefined {
  const raw = kernel.get(KEY_PREFIXES.meta);
  if (raw === undefined) return undefined;
  return JSON.parse(new TextDecoder().decode(raw)) as GraphMeta;
}
