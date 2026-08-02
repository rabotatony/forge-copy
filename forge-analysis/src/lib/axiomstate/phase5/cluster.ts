// ============================================================
// AxiomState Phase 5: Cluster Watch Coordinator
// ============================================================
// Coordinates multiple watch agents writing to a single LSS kernel.
// Provides:
//   - Agent registration / heartbeat tracking
//   - Advisory per-path locks (with TTL) so two agents don't write
//     the same file concurrently
//   - An event bus that broadcasts agent / lock / sync-report events
//     to subscribers (used by the SSE endpoint in the API routes)
//
// State is in-memory; locks are optionally mirrored to the kernel
// under `lock://v1/<encoded-path>` so a separate process could probe
// them. The `lock://v1/__all__` key stores a JSON map of all active
// locks for cold-start recovery.
//
// Server-side only — uses node:crypto for ids and the LSSKernel.
// ============================================================

import { randomBytes } from 'node:crypto';
import { LSSKernel } from '../phase0/kernel';
import type { SyncReport } from '../phase2/types';
import type {
  ClusterAgentInfo,
  ClusterEvent,
  ClusterEventKind,
  ClusterLock,
} from './types';

const LOCK_PREFIX = 'lock://v1/';
const LOCK_ALL_KEY = 'lock://v1/__all__';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeLockKey(path: string): string {
  return `${LOCK_PREFIX}${encodeURIComponent(path)}`;
}

function nowMs(): number {
  return Date.now();
}

function encodeJson(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

function decodeJson<T>(buf: Uint8Array | undefined | null): T | null {
  if (!buf) return null;
  try {
    return JSON.parse(dec.decode(buf)) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ClusterCoordinator
// ---------------------------------------------------------------------------

/**
 * Multi-writer watch coordinator. Holds an in-memory registry of
 * agents and advisory file locks, and broadcasts cluster events to
 * subscribers.
 */
export class ClusterCoordinator {
  private readonly kernel: LSSKernel;
  private readonly agents: Map<string, ClusterAgentInfo> = new Map();
  private readonly locks: Map<string, ClusterLock> = new Map();
  private readonly subscribers: Set<(event: ClusterEvent) => void> = new Set();

  constructor(kernel: LSSKernel) {
    this.kernel = kernel;
    this.restoreLocks();
  }

  // --- Agent registry ------------------------------------------------------

  /**
   * Register a watch agent. If `agentId` is already registered, its
   * `rootDir` is updated and `lastHeartbeat` is refreshed.
   */
  registerAgent(agentId: string, rootDir: string): ClusterAgentInfo {
    const ts = nowMs();
    const existing = this.agents.get(agentId);
    const info: ClusterAgentInfo = {
      agentId,
      rootDir,
      registeredAt: existing?.registeredAt ?? ts,
      lastHeartbeat: ts,
      eventsReceived: existing?.eventsReceived ?? 0,
    };
    this.agents.set(agentId, info);
    this.emit({
      kind: 'agent-registered',
      agentId,
      ts,
      data: { rootDir },
    });
    return info;
  }

  /**
   * Unregister an agent. Releases any locks it still holds.
   */
  unregisterAgent(agentId: string): void {
    const existed = this.agents.delete(agentId);
    if (!existed) return;
    // Release any locks held by this agent.
    for (const [path, lock] of this.locks) {
      if (lock.agentId === agentId) {
        this.releaseLock(agentId, path);
      }
    }
    const ts = nowMs();
    this.emit({ kind: 'agent-unregistered', agentId, ts });
  }

  /**
   * Refresh an agent's heartbeat timestamp.
   */
  heartbeat(agentId: string): void {
    const info = this.agents.get(agentId);
    if (!info) return;
    info.lastHeartbeat = nowMs();
    this.emit({ kind: 'agent-heartbeat', agentId, ts: info.lastHeartbeat });
  }

  /**
   * Return a snapshot of all registered agents.
   */
  getAgents(): ClusterAgentInfo[] {
    return Array.from(this.agents.values());
  }

  // --- Advisory locks ------------------------------------------------------

  /**
   * Try to acquire an advisory lock on `path` for `agentId`.
   *
   * Returns the acquired lock, or `null` if another agent currently
   * holds a non-expired lock on the same path.
   */
  acquireLock(
    agentId: string,
    path: string,
    ttlMs: number = 30_000,
  ): ClusterLock | null {
    this.pruneExpiredLocks();
    const existing = this.locks.get(path);
    if (existing) {
      const expiresAt = existing.acquiredAt + existing.ttlMs;
      if (nowMs() < expiresAt && existing.agentId !== agentId) {
        // Held by someone else.
        return null;
      }
      // Either expired (will be overwritten below) or already held by
      // this agent (re-acquire / refresh).
    }
    const lock: ClusterLock = {
      path,
      agentId,
      acquiredAt: nowMs(),
      ttlMs,
    };
    this.locks.set(path, lock);
    this.persistLocks();
    this.emit({
      kind: 'file-locked',
      agentId,
      path,
      ts: lock.acquiredAt,
      data: { ttlMs },
    });
    return lock;
  }

  /**
   * Release a lock on `path` held by `agentId`. No-op if the lock
   * belongs to a different agent or doesn't exist.
   */
  releaseLock(agentId: string, path: string): void {
    const lock = this.locks.get(path);
    if (!lock || lock.agentId !== agentId) return;
    this.locks.delete(path);
    this.persistLocks();
    const ts = nowMs();
    this.emit({ kind: 'file-unlocked', agentId, path, ts });
  }

  /**
   * Return a snapshot of all active (non-expired) locks.
   */
  getLocks(): ClusterLock[] {
    this.pruneExpiredLocks();
    return Array.from(this.locks.values());
  }

  /**
   * Remove all expired locks. Returns the count of removed locks.
   */
  pruneExpiredLocks(): number {
    const now = nowMs();
    const expired: string[] = [];
    for (const [path, lock] of this.locks) {
      if (now >= lock.acquiredAt + lock.ttlMs) {
        expired.push(path);
      }
    }
    if (expired.length === 0) return 0;
    for (const path of expired) {
      const lock = this.locks.get(path);
      this.locks.delete(path);
      if (lock) {
        this.emit({
          kind: 'lock-expired',
          agentId: lock.agentId,
          path,
          ts: now,
        });
      }
    }
    this.persistLocks();
    return expired.length;
  }

  // --- Sync reports --------------------------------------------------------

  /**
   * Record a sync report from an agent. Emits a `sync-report` event
   * to all subscribers with the full report as `data`.
   */
  recordSyncReport(agentId: string, report: SyncReport): void {
    const info = this.agents.get(agentId);
    if (info) {
      info.eventsReceived++;
      info.lastHeartbeat = nowMs();
    }
    const ts = nowMs();
    this.emit({
      kind: 'sync-report',
      agentId,
      ts,
      data: report as unknown as Record<string, unknown>,
    });
  }

  // --- Event bus -----------------------------------------------------------

  /**
   * Subscribe to cluster events. Returns an unsubscribe function.
   */
  subscribe(listener: (event: ClusterEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /**
   * Broadcast an event to all subscribers. Exposed for API routes
   * that need to inject synthetic events (e.g. error events on
   * request failures).
   */
  emit(event: ClusterEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch {
        // A listener throwing must not break other listeners.
      }
    }
  }

  /**
   * Emit an error event with optional context.
   */
  emitError(agentId: string | undefined, message: string, data?: Record<string, unknown>): void {
    this.emit({
      kind: 'error',
      agentId,
      ts: nowMs(),
      data: { message, ...(data ?? {}) },
    });
  }

  // --- Persistence (best-effort mirror to kernel) --------------------------

  /**
   * Mirror the active lock set into the kernel under `lock://v1/__all__`.
   * This lets a separate process observe (but not mutate) the lock state.
   */
  private persistLocks(): void {
    const all: Record<string, ClusterLock> = {};
    for (const [path, lock] of this.locks) {
      all[path] = lock;
    }
    try {
      this.kernel.apply(LOCK_ALL_KEY, encodeJson(all));
      // Also write per-path keys so prefix scans work.
      for (const [path, lock] of this.locks) {
        this.kernel.apply(encodeLockKey(path), encodeJson(lock));
      }
    } catch {
      // Persistence is best-effort; ignore errors.
    }
  }

  /**
   * Restore locks from the kernel on construction.
   */
  private restoreLocks(): void {
    const all = decodeJson<Record<string, ClusterLock>>(this.kernel.get(LOCK_ALL_KEY));
    if (!all) return;
    const now = nowMs();
    for (const [path, lock] of Object.entries(all)) {
      if (now >= lock.acquiredAt + lock.ttlMs) continue; // already expired
      this.locks.set(path, lock);
    }
  }

  // --- Diagnostics ---------------------------------------------------------

  /**
   * Generate a fresh random agent id (8 bytes hex). Useful for agents
   * that don't supply their own id.
   */
  static generateAgentId(): string {
    return randomBytes(8).toString('hex');
  }
}

// ---------------------------------------------------------------------------
// Re-export the LOCK prefix for callers that want to probe the kernel directly
// ---------------------------------------------------------------------------

export { LOCK_PREFIX, LOCK_ALL_KEY };
export type { ClusterEventKind } from './types';
