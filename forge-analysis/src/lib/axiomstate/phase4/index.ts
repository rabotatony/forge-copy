// ============================================================
// AxiomState Phase 4: Public Surface
// ============================================================

// Persistent index
export {
  saveIndex,
  loadIndex,
  patchIndex,
  dropIndex,
  isPersistedIndexCurrent,
} from './persistent-index';

// Remote kernel
export { createServer } from './remote/server';
export { RemoteKernelClient } from './remote/client';

// Source maps
export {
  generateBundleSourceMap,
  concatenateWithSourceMap,
} from './sourcemaps';

// Types
export type {
  PersistentIndexMeta,
  RemoteRequest,
  RemoteResponse,
  RemoteMethod,
  RemoteServerOptions,
  RemoteClientOptions,
  SourceMapV3,
  SourceMappedBundle,
  SourceMappedEntry,
  SourceMapOptions,
  WatchIntegrationResult,
} from './types';

export {
  IDX_PREFIX,
  IDX_META_KEY,
  IDX_KIND_PREFIX,
  IDX_NAME_PREFIX,
} from './types';
