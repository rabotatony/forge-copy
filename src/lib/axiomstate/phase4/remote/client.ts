// ============================================================
// AxiomState Phase 4: Remote Kernel Client
// ============================================================
// Mirrors the LSSKernel interface over the NDJSON wire protocol.
// All methods are async (returns a Promise) because they involve
// a network round-trip.
// ============================================================

import * as net from 'node:net';
import { encodeRequest, parseResponse, LineParser, makeId } from './protocol';
import type { RemoteClientOptions } from '../types';

const DEFAULT_PORT = 7070;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RemoteKernelClient {
  private socket: net.Socket | null = null;
  private pending = new Map<string, Pending>();
  private parser = new LineParser();
  private connected = false;
  private opts: Required<RemoteClientOptions>;

  constructor(opts: RemoteClientOptions = {}) {
    this.opts = {
      port: opts.port ?? DEFAULT_PORT,
      socketPath: opts.socketPath ?? '',
      connectTimeoutMs: opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  // ── Connection management ─────────────────────────────────

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy(new Error('connect timeout'));
      }, this.opts.connectTimeoutMs);

      const connectArgs = this.opts.socketPath
        ? { path: this.opts.socketPath }
        : { port: this.opts.port, host: '127.0.0.1' };

      socket.connect(connectArgs, () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.connected = true;
        resolve();
      });

      socket.on('data', (chunk: Buffer) => {
        let lines: string[];
        try { lines = this.parser.push(chunk); }
        catch { this.rejectAll(new Error('protocol parse error')); return; }
        for (const line of lines) {
          try {
            const res = parseResponse(line);
            const p = this.pending.get(res.id);
            if (!p) continue;
            clearTimeout(p.timer);
            this.pending.delete(res.id);
            if ('error' in res) p.reject(new Error(res.error));
            else p.resolve(res.result);
          } catch (err) {
            this.rejectAll(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        if (!this.connected) { reject(err); return; }
        this.rejectAll(err);
      });

      socket.on('close', () => {
        this.connected = false;
        this.socket = null;
        this.rejectAll(new Error('connection closed'));
      });
    });
  }

  close(): Promise<void> {
    return this.request('close', {}).then(
      () => { this.socket?.destroy(); },
      () => { this.socket?.destroy(); },
    );
  }

  // ── LSS Kernel interface (async) ─────────────────────────

  async apply(key: string, value: Uint8Array | null): Promise<bigint> {
    const args: Record<string, unknown> = {
      key,
      value: value === null ? null : Buffer.from(value).toString('base64'),
    };
    const r = await this.request('apply', args) as { seq: string };
    return BigInt(r.seq);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const r = await this.request('get', { key }) as { found: boolean; value: string | null };
    if (!r.found || r.value === null) return undefined;
    return new Uint8Array(Buffer.from(r.value, 'base64'));
  }

  async checkpoint(): Promise<bigint> {
    const r = await this.request('checkpoint', {}) as { seq: string };
    return BigInt(r.seq);
  }

  async rollback(seq: bigint): Promise<void> {
    await this.request('rollback', { seq: String(seq) });
  }

  async stats(): Promise<{ seq: bigint; keyCount: number; checkpointSeq: bigint; walBytes: number }> {
    const r = await this.request('stats', {}) as {
      seq: string; keyCount: number; checkpointSeq: string; walBytes: number;
    };
    return {
      seq: BigInt(r.seq),
      keyCount: r.keyCount,
      checkpointSeq: BigInt(r.checkpointSeq),
      walBytes: r.walBytes,
    };
  }

  async keys(): Promise<string[]> {
    const r = await this.request('keys', {}) as { keys: string[] };
    return r.keys;
  }

  async current(): Promise<Map<string, Uint8Array | null>> {
    const r = await this.request('current', {}) as { entries: Record<string, string | null> };
    const m = new Map<string, Uint8Array | null>();
    for (const [k, v] of Object.entries(r.entries)) {
      m.set(k, v === null ? null : new Uint8Array(Buffer.from(v, 'base64')));
    }
    return m;
  }

  async ping(): Promise<string> {
    return this.request('ping', {}) as Promise<string>;
  }

  // ── Internal ──────────────────────────────────────────────

  private request(method: string, args: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error('not connected'));
        return;
      }
      const id = makeId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request timeout: ${method}`));
      }, this.opts.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(encodeRequest({ id, method: method as import('../types.js').RemoteMethod, args }));
    });
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
