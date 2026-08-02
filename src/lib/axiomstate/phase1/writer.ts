import { LSSKernel } from '../phase0/kernel';
import { KEY_PREFIXES } from './types';
import type { GraphDelta } from './types';

export interface WriteGraphOptions {
  checkpoint?: boolean;
  providerName?: string;
}

export function writeGraph(kernel: LSSKernel, delta: GraphDelta, options: WriteGraphOptions = {}): bigint {
  for (const node of delta.nodes) {
    kernel.apply(`${KEY_PREFIXES.node}${node.id}`, node.payload);
  }
  for (const edge of delta.edges) {
    const key = `${KEY_PREFIXES.edge}${edge.from}/${edge.to}`;
    const value = edge.meta === undefined
      ? new Uint8Array(0)
      : new TextEncoder().encode(JSON.stringify(edge.meta));
    kernel.apply(key, value);
  }
  const meta = {
    lastParseSeq: String(kernel.stats().seq),
    providerName: options.providerName ?? 'unknown',
    fileCount: delta.nodes.filter(n => n.kind === 'file').length,
    nodeCount: delta.nodes.length,
    edgeCount: delta.edges.length,
  };
  kernel.apply(KEY_PREFIXES.meta, new TextEncoder().encode(JSON.stringify(meta)));
  const seq = kernel.stats().seq;
  if (options.checkpoint) kernel.checkpoint();
  return seq;
}
