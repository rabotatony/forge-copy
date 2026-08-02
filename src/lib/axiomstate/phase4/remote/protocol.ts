// ============================================================
// AxiomState Phase 4: Remote Kernel — Wire Protocol
// ============================================================
// Newline-delimited JSON (NDJSON) over TCP or Unix sockets.
// Each line is exactly one JSON object, terminated by '\n'.
// ============================================================

import type { RemoteRequest, RemoteResponse } from '../types';

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export function encodeRequest(req: RemoteRequest): Buffer {
  return Buffer.from(JSON.stringify(req) + '\n', 'utf-8');
}

export function encodeResponse(res: RemoteResponse): Buffer {
  return Buffer.from(JSON.stringify(res) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Incremental line parser
// ---------------------------------------------------------------------------

/**
 * Accumulates raw bytes and emits complete JSON lines.
 * One instance per connection, reused across chunks.
 */
export class LineParser {
  private buf = '';

  push(chunk: Buffer): string[] {
    this.buf += chunk.toString('utf-8');
    const lines: string[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  reset(): void {
    this.buf = '';
  }
}

// ---------------------------------------------------------------------------
// Request / response helpers
// ---------------------------------------------------------------------------

export function parseRequest(line: string): RemoteRequest {
  const obj = JSON.parse(line) as RemoteRequest;
  if (typeof obj.id !== 'string') throw new Error('missing id');
  if (typeof obj.method !== 'string') throw new Error('missing method');
  return obj;
}

export function parseResponse(line: string): RemoteResponse {
  return JSON.parse(line) as RemoteResponse;
}

export function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
