import { LSSKernel } from '../phase0/kernel';
import { KEY_PREFIXES } from './types';
import { loadAllNodes } from './loader';
import type { GraphNode, SliceResult } from './types';

function loadNodeSafe(kernel: LSSKernel, id: string): GraphNode | undefined {
  const raw = kernel.get(`${KEY_PREFIXES.node}${id}`);
  if (raw === undefined) return undefined;
  try {
    const payload = JSON.parse(new TextDecoder().decode(raw)) as { kind: 'file' | 'symbol'; name: string; deps: string[] };
    return { id, kind: payload.kind, name: payload.name, payload: raw, deps: payload.deps };
  } catch {
    return undefined;
  }
}

export function sliceForward(
  kernel: LSSKernel,
  startIds: string | readonly string[],
  maxDepth: number = Infinity,
): SliceResult {
  const roots = Array.isArray(startIds) ? startIds : [startIds as string];
  const nodes = new Map<string, GraphNode>();
  const edges: SliceResult['edges'] = [];
  const visited = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = roots.map(id => ({ id, depth: 0 }));
  for (const id of roots) visited.set(id, 0);

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { id, depth } = item;
    if (depth > maxDepth) continue;
    if (nodes.has(id)) continue;
    const node = loadNodeSafe(kernel, id);
    if (!node) continue;
    nodes.set(id, node);
    for (const dep of node.deps) {
      edges.push({ from: id, to: dep });
      const existingDepth = visited.get(dep);
      const nextDepth = depth + 1;
      if (existingDepth === undefined || nextDepth < existingDepth) {
        visited.set(dep, nextDepth);
        queue.push({ id: dep, depth: nextDepth });
      }
    }
  }
  return { startIds: roots, nodes, edges };
}

export function sliceReverse(
  kernel: LSSKernel,
  targetId: string,
  maxDepth: number = Infinity,
): SliceResult {
  const allNodes = loadAllNodes(kernel);
  const reverseAdj = new Map<string, string[]>();
  for (const [id, node] of allNodes) {
    for (const dep of node.deps) {
      const list = reverseAdj.get(dep) ?? [];
      list.push(id);
      reverseAdj.set(dep, list);
    }
  }
  const nodes = new Map<string, GraphNode>();
  const edges: SliceResult['edges'] = [];
  const visited = new Map<string, number>();
  const queue = [{ id: targetId, depth: 0 }];
  visited.set(targetId, 0);

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { id, depth } = item;
    if (depth > maxDepth) continue;
    const node = allNodes.get(id);
    if (node) nodes.set(id, node);
    const incoming = reverseAdj.get(id) ?? [];
    for (const src of incoming) {
      edges.push({ from: src, to: id });
      const nextDepth = depth + 1;
      const existingDepth = visited.get(src);
      if (existingDepth === undefined || nextDepth < existingDepth) {
        visited.set(src, nextDepth);
        queue.push({ id: src, depth: nextDepth });
      }
    }
  }
  return { startIds: [targetId], nodes, edges };
}

export function resolveDependencies(kernel: LSSKernel, id: string): string[] {
  const node = loadNodeSafe(kernel, id);
  return node ? Array.from(node.deps) : [];
}
