// ============================================================
// AxiomState Phase 2: Query & Execution Domain
// ============================================================
export const HASH_PREFIX = 'hash://';
export const SOURCE_PREFIX = 'source://';
export const FILE_INDEX_PREFIX = 'file-index://';

export interface FileIndex {
  path: string;
  nodeIds: string[];
  edgeKeys: string[];
}

export interface SyncReport {
  scanned: number;
  changed: string[];
  removed: string[];
  unchanged: number;
}

export interface BundleEntry {
  id: string;
  path: string;
  content: Uint8Array;
}

export interface BundleResult {
  order: string[];
  entries: BundleEntry[];
  cycles: string[][];
}
