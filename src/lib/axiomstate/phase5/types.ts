// ============================================================
// AxiomState Phase 5: Persistent Source Maps, HMAC Auth,
//                     Incremental Source Maps & Cluster Watch
// ============================================================
// Shared types for the Phase 5 surface. Server-side only — these
// modules use node:crypto / node:fs and must never be imported
// from a client component.
// ============================================================

// --- Re-exports so callers can import shared types from this module ---------
import type { SourceMapV3 } from '../phase4/types';
export type { SyncReport } from '../phase2/types';
export type { SourceMapV3 } from '../phase4/types';

// --- Persistent source maps -------------------------------------------------

/**
 * LSS key prefix for all persistent source map data.
 * Format: `sm://v1/<percent-encoded-bundleId>`
 */
export const SM_PREFIX = 'sm://v1/';
export const SM_META_KEY = 'sm://v1/__meta__';

/** Aggregate metadata about every stored source map. */
export interface PersistentSourceMapMeta {
  /** All known stored bundle ids (sorted, deduped). */
  bundleIds: string[];
  /** BigInt kernel seq at which meta was last saved (decimal string). */
  savedAt: string;
  /** Number of stored source maps. */
  count: number;
}

/** A single stored source map plus its bookkeeping fields. */
export interface StoredSourceMap {
  bundleId: string;
  sourceMap: SourceMapV3;
  /** BigInt kernel seq at which this map was saved (decimal string). */
  savedAt: string;
  /** Byte length of the bundle output this map describes. */
  outputBytes: number;
  /** Convenience copy of `sourceMap.sources`. */
  sources: string[];
}

// --- HMAC authentication ----------------------------------------------------

/** Options controlling request signing and verification. */
export interface AuthOptions {
  /** Shared secret (utf-8 encoded). */
  secret: string;
  /** Replay window in seconds (default: 30). */
  windowSeconds?: number;
}

/** A signed remote-kernel request. */
export interface SignedRequest {
  id: string;
  method: string;
  args: Record<string, unknown>;
  /** Unix seconds. */
  ts: number;
  /** Random nonce (16 hex chars). */
  nonce: string;
  /** Hex HMAC-SHA256 signature. */
  sig: string;
}

// --- Incremental source maps ------------------------------------------------

/** Result of an incremental bundle + source-map build. */
export interface IncrementalSourceMapResult {
  bundleId: string;
  output: Uint8Array;
  sourceMap: SourceMapV3;
  /** Number of per-entry VLQ mappings reused from the previous bundle. */
  reusedEntries: number;
  /** Number of per-entry VLQ mappings rebuilt from scratch. */
  rebuiltEntries: number;
  /** Total number of entries in the bundle. */
  totalEntries: number;
}

// --- Cluster watch ----------------------------------------------------------

/** Information about a registered watch agent. */
export interface ClusterAgentInfo {
  agentId: string;
  rootDir: string;
  registeredAt: number;
  lastHeartbeat: number;
  eventsReceived: number;
}

/** An advisory lock held by an agent on a relative file path. */
export interface ClusterLock {
  /** Relative file path being written. */
  path: string;
  agentId: string;
  acquiredAt: number;
  /** Lock time-to-live in milliseconds. */
  ttlMs: number;
}

/** Kinds of events emitted by the cluster coordinator. */
export type ClusterEventKind =
  | 'agent-registered'
  | 'agent-unregistered'
  | 'agent-heartbeat'
  | 'file-locked'
  | 'file-unlocked'
  | 'lock-expired'
  | 'sync-report'
  | 'error';

/** An event broadcast by the cluster coordinator. */
export interface ClusterEvent {
  kind: ClusterEventKind;
  agentId?: string;
  path?: string;
  /** Unix milliseconds. */
  ts: number;
  data?: Record<string, unknown>;
}

/** Re-export so callers can import SyncReport alongside cluster types. */
export type { SyncReport as ClusterSyncReport } from '../phase2/types';
