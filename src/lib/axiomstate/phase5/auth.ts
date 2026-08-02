// ============================================================
// AxiomState Phase 5: HMAC Shared-Secret Authentication
// ============================================================
// Signs and verifies remote-kernel requests using HMAC-SHA256 over
// a canonical request string. Includes a small in-memory LRU nonce
// cache to reject replayed nonces within the configured window.
//
// Server-side only — uses node:crypto.
// ============================================================

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthOptions, SignedRequest } from './types';

const DEFAULT_WINDOW_SECONDS = 30;
const NONCE_CACHE_CAPACITY = 1024;

// ---------------------------------------------------------------------------
// Canonical request string
// ---------------------------------------------------------------------------

/**
 * Build the canonical string that is HMAC-signed for a request.
 *
 * Format: `${id}|${method}|${ts}|${nonce}|${JSON.stringify(args)}`
 *
 * `args` MUST be serialised with stable key ordering so that both client
 * and server compute identical strings. We achieve determinism via
 * `JSON.stringify` which iterates object keys in insertion order — callers
 * should construct `args` with the same key order on both sides (or use
 * string keys sorted alphabetically when in doubt).
 */
export function canonicalRequestString(
  id: string,
  method: string,
  ts: number,
  nonce: string,
  args: Record<string, unknown>,
): string {
  return `${id}|${method}|${ts}|${nonce}|${JSON.stringify(args)}`;
}

// ---------------------------------------------------------------------------
// Nonce cache (LRU, capped at NONCE_CACHE_CAPACITY)
// ---------------------------------------------------------------------------

/**
 * Bounded LRU set of nonces that have been observed during verification.
 * When the cache fills, the oldest entry is evicted.
 *
 * The cache is process-local; in a multi-process deployment each process
 * would maintain its own cache. For our Next.js use case (single in-process
 * server) this is sufficient.
 */
export class NonceCache {
  private readonly capacity: number;
  private readonly seenNonces: Map<string, number> = new Map();

  constructor(capacity: number = NONCE_CACHE_CAPACITY) {
    this.capacity = capacity;
  }

  /** Returns true if `nonce` has already been observed. */
  seen(nonce: string): boolean {
    return this.seenNonces.has(nonce);
  }

  /** Mark `nonce` as observed, evicting the oldest entry if at capacity. */
  add(nonce: string): void {
    if (this.seenNonces.has(nonce)) {
      // Move to end (most recently used).
      this.seenNonces.delete(nonce);
      this.seenNonces.set(nonce, Date.now());
      return;
    }
    if (this.seenNonces.size >= this.capacity) {
      // Evict oldest entry (first key in insertion order).
      const oldest = this.seenNonces.keys().next().value;
      if (oldest !== undefined) this.seenNonces.delete(oldest);
    }
    this.seenNonces.set(nonce, Date.now());
  }

  /** Clear the cache (useful for tests / reset). */
  clear(): void {
    this.seenNonces.clear();
  }

  /** Current size (exposed for diagnostics). */
  get size(): number {
    return this.seenNonces.size;
  }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign a request by computing its HMAC-SHA256 signature.
 *
 * The returned object is the input request plus a `sig` field containing
 * the hex-encoded HMAC.
 */
export function signRequest(
  req: Omit<SignedRequest, 'sig'>,
  opts: AuthOptions,
): SignedRequest {
  const canonical = canonicalRequestString(
    req.id,
    req.method,
    req.ts,
    req.nonce,
    req.args,
  );
  const sig = createHmac('sha256', opts.secret)
    .update(canonical, 'utf-8')
    .digest('hex');
  return { ...req, sig };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

// Module-level default nonce cache so all verifiers in this process share
// the same replay-protection window. Callers may construct their own
// NonceCache and pass it to `verifyRequest` if they want isolation.
const DEFAULT_NONCE_CACHE = new NonceCache();

export interface VerifyOptions extends AuthOptions {
  /** Optional explicit nonce cache (defaults to a process-wide singleton). */
  nonceCache?: NonceCache;
  /** Current time in seconds (override for tests; defaults to Date.now()/1000). */
  now?: () => number;
}

/**
 * Verify a signed request:
 *   1. Recompute the HMAC and compare to `req.sig` (constant-time).
 *   2. Check `req.ts` is within `windowSeconds` of the current time.
 *   3. Reject if `req.nonce` has already been seen (replay protection).
 *
 * Returns `{ ok: true }` on success or `{ ok: false, reason }` on failure.
 */
export function verifyRequest(
  req: SignedRequest,
  opts: VerifyOptions,
): { ok: true } | { ok: false; reason: string } {
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const cache = opts.nonceCache ?? DEFAULT_NONCE_CACHE;

  // 1. Timestamp window.
  const skew = Math.abs(now - req.ts);
  if (skew > windowSeconds) {
    return {
      ok: false,
      reason: `timestamp skew ${skew}s exceeds window ${windowSeconds}s`,
    };
  }

  // 2. Replay protection.
  if (cache.seen(req.nonce)) {
    return { ok: false, reason: `nonce replayed: ${req.nonce}` };
  }

  // 3. Signature comparison (constant-time).
  const canonical = canonicalRequestString(
    req.id,
    req.method,
    req.ts,
    req.nonce,
    req.args,
  );
  const expected = createHmac('sha256', opts.secret)
    .update(canonical, 'utf-8')
    .digest('hex');

  if (!timingSafeEqualHex(expected, req.sig)) {
    return { ok: false, reason: 'signature mismatch' };
  }

  // Mark nonce as observed AFTER all checks pass.
  cache.add(req.nonce);
  return { ok: true };
}

/**
 * Constant-time hex string comparison.
 * Returns false immediately if lengths differ (this leaks length, which is
 * fine because hex-encoded HMAC-SHA256 always has length 64).
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Nonce generation
// ---------------------------------------------------------------------------

/**
 * Generate a random 16-character hex nonce.
 */
export function generateNonce(): string {
  return randomBytes(8).toString('hex');
}
