// ============================================================
// AxiomState Phase 5: Public Surface
// ============================================================
// Re-exports everything from the four Phase 5 modules so callers
// can import from a single entry point:
//
//   import {
//     signRequest, verifyRequest,
//     saveSourceMap, loadSourceMap, listSourceMaps,
//     dropSourceMap, dropAllSourceMaps,
//     incrementalBundleWithSourceMap,
//     ClusterCoordinator,
//   } from '@/lib/axiomstate/phase5';
// ============================================================

// Types
export type {
  SM_PREFIX as SM_PREFIX_TYPE,
  AuthOptions,
  SignedRequest,
  PersistentSourceMapMeta,
  StoredSourceMap,
  IncrementalSourceMapResult,
  ClusterAgentInfo,
  ClusterLock,
  ClusterEventKind,
  ClusterEvent,
  ClusterSyncReport,
} from './types';

export {
  SM_PREFIX,
  SM_META_KEY,
} from './types';

// Auth
export {
  signRequest,
  verifyRequest,
  generateNonce,
  canonicalRequestString,
  NonceCache,
} from './auth';
export type { VerifyOptions } from './auth';

// Persistent source maps
export {
  saveSourceMap,
  loadSourceMap,
  listSourceMaps,
  dropSourceMap,
  dropAllSourceMaps,
  getSourceMapMeta,
  enumerateSourceMaps,
} from './persistent-sourcemaps';

// Incremental source maps
export {
  incrementalBundleWithSourceMap,
  generateBundleSourceMap,
  concatenateWithSourceMap,
} from './incremental-sourcemaps';
export type { IncrementalBundleOptions } from './incremental-sourcemaps';

// Cluster
export { ClusterCoordinator, LOCK_PREFIX, LOCK_ALL_KEY } from './cluster';
