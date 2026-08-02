// ============================================================
// AxiomState Phase 3: Watch Mode
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LSSKernel } from '../phase0/kernel';
import { IncrementalEngine } from '../phase2/incremental';
import type { WatchEvent, WatchHandler, WatchOptions, Watcher } from './types';

const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Watch a project directory for file changes and keep the graph in sync.
 *
 * Events emitted:
 *   - ready       — emitted once the initial sync completes
 *   - added       — a new file appeared
 *   - changed     — an existing file was modified
 *   - removed     — a file was deleted
 *   - error       — an I/O or sync error occurred
 *   - close       — the watcher was stopped
 *
 * Phase 3 constraint: no vector search. All change detection is hash-based
 * (delegated to IncrementalEngine).
 */
export function watch(
  kernel: LSSKernel,
  rootDir: string,
  handler: WatchHandler,
  options: WatchOptions = {},
): Watcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const usePolling = options.usePolling ?? false;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const engine = new IncrementalEngine({ exclude: options.exclude });

  let closed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Pending raw filenames from fs.watch events, deduped before sync.
  const pendingRaw = new Set<string>();

  const triggerSync = (): void => {
    if (closed) return;
    try {
      const report = engine.sync(kernel, rootDir);
      for (const f of report.changed) {
        handler({ kind: 'changed', path: f, syncReport: report });
      }
      for (const f of report.removed) {
        handler({ kind: 'removed', path: f, syncReport: report });
      }
      // Files in changed that weren't previously tracked are "added".
      // IncrementalEngine doesn't distinguish; we report all as changed
      // here (the sync report contains the full picture).
    } catch (err) {
      handler({ kind: 'error', error: err instanceof Error ? err : new Error(String(err)) });
    }
  };

  const scheduleSync = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      pendingRaw.clear();
      triggerSync();
    }, debounceMs);
  };

  // -- Initial sync ----------------------------------------------------------
  try {
    const report = engine.sync(kernel, rootDir);
    handler({ kind: 'ready', syncReport: report });
  } catch (err) {
    handler({ kind: 'error', error: err instanceof Error ? err : new Error(String(err)) });
  }

  // -- Set up file watching --------------------------------------------------
  let fsWatchers: fs.FSWatcher[] = [];
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  if (usePolling) {
    // Polling fallback: compare hashes on a fixed interval.
    pollInterval = setInterval(() => {
      if (!closed) scheduleSync();
    }, pollIntervalMs);
  } else {
    // Use fs.watch recursively on the root directory.
    // Falls back to polling on platforms where recursive watch isn't supported.
    try {
      const watcher = fs.watch(rootDir, { recursive: true }, (_event, filename) => {
        if (closed) return;
        if (filename) pendingRaw.add(filename);
        scheduleSync();
      });
      watcher.on('error', (err: Error) => {
        if (!closed) handler({ kind: 'error', error: err });
      });
      fsWatchers.push(watcher);
    } catch {
      // fs.watch failed — fall back to polling.
      pollInterval = setInterval(() => {
        if (!closed) scheduleSync();
      }, pollIntervalMs);
    }
  }

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (pollInterval !== null) clearInterval(pollInterval);
      for (const w of fsWatchers) {
        try { w.close(); } catch { /* ignore */ }
      }
      fsWatchers = [];
      handler({ kind: 'close' });
    },
  };
}

/**
 * Convenience: watch with async/iterator style.
 * Yields WatchEvents until the watcher is closed.
 */
export function watchAsync(
  kernel: LSSKernel,
  rootDir: string,
  options: WatchOptions = {},
): { events: AsyncIterable<WatchEvent>; close: () => void } {
  const queue: WatchEvent[] = [];
  const resolvers: Array<(v: IteratorResult<WatchEvent>) => void> = [];
  let done = false;
  let watcher: Watcher;

  const push = (event: WatchEvent): void => {
    if (resolvers.length > 0) {
      const resolve = resolvers.shift()!;
      resolve({ value: event, done: false });
    } else {
      queue.push(event);
    }
    if (event.kind === 'close') done = true;
  };

  watcher = watch(kernel, rootDir, push, options);

  const events: AsyncIterable<WatchEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<WatchEvent>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (done) return Promise.resolve({ value: undefined as unknown as WatchEvent, done: true });
          return new Promise(resolve => resolvers.push(resolve));
        },
        return(): Promise<IteratorResult<WatchEvent>> {
          watcher.close();
          return Promise.resolve({ value: undefined as unknown as WatchEvent, done: true });
        },
      };
    },
  };

  return {
    events,
    close(): void { watcher.close(); },
  };
}

/**
 * Resolve a relative filename (from fs.watch event) to a canonical path.
 * Returns null if the file is outside the watched root.
 */
export function resolveWatchedPath(rootDir: string, filename: string): string | null {
  const full = path.resolve(rootDir, filename);
  if (!full.startsWith(path.resolve(rootDir))) return null;
  return path.relative(rootDir, full);
}
