// ============================================================
// AxiomState Phase 3: Query Planner, Watch, Transforms & Cache
// ============================================================

/** In-memory index built from kernel state for O(1) kind/name lookups. */
export interface QueryIndex {
  /** kind -> Set<nodeId> */
  byKind: Map<string, Set<string>>;
  /** lowercased-name -> nodeId[] */
  byName: Map<string, string[]>;
  /** kernel sequence at which this index was built */
  builtAt: bigint;
  /** total node count */
  nodeCount: number;
}

/** Optimized, plan-aware query representation. */
export type QueryPlan =
  | { strategy: 'index-kind'; kind: string }
  | { strategy: 'index-name'; pattern: string }
  | { strategy: 'exact-node'; id: string }
  | { strategy: 'graph-forward'; of: string; depth?: number }
  | { strategy: 'graph-reverse'; of: string; depth?: number }
  | { strategy: 'intersect'; plans: QueryPlan[] }
  | { strategy: 'union'; plans: QueryPlan[] }
  | { strategy: 'difference'; universe: QueryPlan; exclude: QueryPlan }
  | { strategy: 'full-scan'; reason: string };

/** Snapshot of all live kernel keys+values for diffing. */
export interface KernelSnapshot {
  entries: Map<string, Uint8Array>;
  takenAt: bigint;
}

/** Diff between two kernel snapshots. */
export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
  totalDelta: number;
}

// --- Watch mode types -------------------------------------------------------

export type WatchEventKind = 'added' | 'changed' | 'removed' | 'error' | 'ready' | 'close';

export interface WatchEvent {
  kind: WatchEventKind;
  path?: string;
  error?: Error;
  syncReport?: import('../phase2/types.js').SyncReport;
}

export type WatchHandler = (event: WatchEvent) => void;

export interface WatchOptions {
  /** Debounce window in ms before triggering a sync (default: 50). */
  debounceMs?: number;
  /** Fall back to polling instead of fs.watch (default: false). */
  usePolling?: boolean;
  /** Polling interval in ms when usePolling=true (default: 500). */
  pollIntervalMs?: number;
  /** Directories/files to exclude (passed to IncrementalEngine). */
  exclude?: Set<string>;
}

export interface Watcher {
  /** Stop watching and release resources. */
  close(): void;
}

// --- Code transform types ---------------------------------------------------

export interface TransformContext {
  /** Relative file path. */
  path: string;
  /** Raw file bytes as loaded from the bundle. */
  content: Uint8Array;
  /** Decoded text (utf-8). */
  sourceText: string;
}

export interface TransformResult {
  content: Uint8Array;
}

export type TransformFn = (ctx: TransformContext) => TransformResult;

export interface TransformPipelineOptions {
  transforms: TransformFn[];
}

export interface TransformedBundle {
  order: string[];
  entries: Array<{ id: string; path: string; content: Uint8Array; transformed: boolean }>;
  cycles: string[][];
}

// --- CI cache invalidation types --------------------------------------------

export interface CacheReport {
  /** Relative file paths that changed (input). */
  changedFiles: string[];
  /** Node ids whose outputs must be rebuilt. */
  mustRebuild: string[];
  /** Node ids that are definitely safe to skip. */
  canSkip: string[];
  affectedCount: number;
  totalNodes: number;
}

export interface InvalidationOptions {
  /** Maximum reverse-dependency depth to walk (default: Infinity). */
  maxDepth?: number;
}
