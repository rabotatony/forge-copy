// ============================================================
// AxiomState Phase 4: Persistent Index, Remote Kernel,
//                     Source Maps & Watch Integration
// ============================================================

// --- Persistent Index -------------------------------------------------------

/**
 * LSS key prefix for all persistent index data.
 * Format: idx://v1/<sub-key>
 */
export const IDX_PREFIX = 'idx://v1/';
export const IDX_META_KEY = `${IDX_PREFIX}meta`;
export const IDX_KIND_PREFIX = `${IDX_PREFIX}kind/`;
export const IDX_NAME_PREFIX = `${IDX_PREFIX}name/`;

export interface PersistentIndexMeta {
  builtAt: string;    // bigint serialised as decimal string
  nodeCount: number;
  kindKeys: string[]; // all kind bucket keys in use (for enumeration)
  nameKeys: string[]; // all name bucket keys in use
}

// --- Remote Kernel Protocol -------------------------------------------------

/** Wire-level request sent from client to server. */
export interface RemoteRequest {
  id: string;
  method: RemoteMethod;
  args: Record<string, unknown>;
}

/** Wire-level response sent from server to client. */
export type RemoteResponse =
  | { id: string; result: unknown }
  | { id: string; error: string };

export type RemoteMethod =
  | 'apply'
  | 'get'
  | 'checkpoint'
  | 'rollback'
  | 'stats'
  | 'keys'
  | 'current'
  | 'ping'
  | 'close';

export interface RemoteServerOptions {
  /** TCP port to listen on (default: 7070). */
  port?: number;
  /** Unix socket path (overrides port when set). */
  socketPath?: string;
  /** Max simultaneous connections (default: unlimited). */
  maxConnections?: number;
}

export interface RemoteClientOptions {
  /** TCP port (default: 7070). */
  port?: number;
  /** Unix socket path (overrides port when set). */
  socketPath?: string;
  /** Connection timeout in ms (default: 5000). */
  connectTimeoutMs?: number;
  /** Per-request timeout in ms (default: 10000). */
  requestTimeoutMs?: number;
}

// --- Source Maps (V3 format) ------------------------------------------------

/** A Source Map V3 object (https://tc39.es/source-map-spec/). */
export interface SourceMapV3 {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;  // VLQ-encoded
}

/** Per-entry source map metadata attached to a transformed bundle. */
export interface SourceMappedEntry {
  id: string;
  path: string;
  content: Uint8Array;
  transformed: boolean;
  /** Line count in the output for this entry (before the separator line). */
  outputLines: number;
  /** Absolute 0-based output line where this entry starts. */
  outputLineOffset: number;
  /** V3 source map for this entry's content individually. */
  entryMap: SourceMapV3;
}

/** A TransformedBundle with full V3 source-map data. */
export interface SourceMappedBundle {
  order: string[];
  entries: SourceMappedEntry[];
  cycles: string[][];
  /** Unified V3 source map for the whole concatenated output. */
  bundleMap: SourceMapV3;
}

export interface SourceMapOptions {
  /** Root directory for relative source paths (default: process.cwd()). */
  sourceRoot?: string;
  /** Whether to inline sourcesContent (default: true). */
  inlineSources?: boolean;
  /** Output file name hint (default: 'bundle.js'). */
  outputFile?: string;
}

// --- Watch Integration (phase 4 adds structured result type) ----------------

export interface WatchIntegrationResult {
  events: import('../phase3/types.js').WatchEvent[];
  elapsed: number;
}
