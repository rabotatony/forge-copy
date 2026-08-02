// ============================================================
// AxiomState Phase 4: Remote Kernel Server
// ============================================================
// Exposes an LSSKernel over a TCP or Unix-socket connection
// using the newline-delimited JSON protocol.
//
// Supported methods:
//   apply, get, checkpoint, rollback, stats, keys, current, ping, close
// ============================================================

import * as net from 'node:net';
import { LSSKernel } from '../../phase0/kernel';
import { encodeResponse, parseRequest, LineParser } from './protocol';
import type { RemoteRequest, RemoteServerOptions } from '../types';

const DEFAULT_PORT = 7070;

export interface RemoteServer {
  /** Stop accepting new connections and close all existing ones. */
  close(): Promise<void>;
  /** Address string for diagnostics (e.g. "tcp:127.0.0.1:7070"). */
  address: string;
}

/**
 * Start a remote kernel server.
 *
 * The server holds a reference to a caller-owned `LSSKernel`.
 * The caller is responsible for closing the kernel after the server closes.
 */
export function createServer(
  kernel: LSSKernel,
  options: RemoteServerOptions = {},
): Promise<RemoteServer> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>();

    const server = net.createServer((socket) => {
      sockets.add(socket);
      const parser = new LineParser();

      socket.on('data', (chunk: Buffer) => {
        let lines: string[];
        try { lines = parser.push(chunk); }
        catch { socket.destroy(); return; }

        for (const line of lines) {
          let req: RemoteRequest;
          try { req = parseRequest(line); }
          catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            socket.write(encodeResponse({ id: '?', error: `parse error: ${errMsg}` }));
            continue;
          }
          handleRequest(kernel, req, socket);
        }
      });

      socket.on('error', () => { /* suppress ECONNRESET etc */ });
      socket.on('close', () => sockets.delete(socket));
    });

    server.on('error', reject);

    if (options.socketPath) {
      server.listen(options.socketPath, () => {
        resolve(makeServerHandle(server, sockets, `unix:${options.socketPath}`));
      });
    } else {
      const port = options.port ?? DEFAULT_PORT;
      server.listen(port, '127.0.0.1', () => {
        resolve(makeServerHandle(server, sockets, `tcp:127.0.0.1:${port}`));
      });
    }
  });
}

function makeServerHandle(
  server: net.Server,
  sockets: Set<net.Socket>,
  address: string,
): RemoteServer {
  return {
    address,
    close(): Promise<void> {
      return new Promise((resolve) => {
        for (const s of sockets) { try { s.destroy(); } catch { /* ignore */ } }
        sockets.clear();
        server.close(() => resolve());
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Request dispatch
// ---------------------------------------------------------------------------

function handleRequest(
  kernel: LSSKernel,
  req: RemoteRequest,
  socket: net.Socket,
): void {
  try {
    const result = dispatch(kernel, req);
    if (result instanceof Promise) {
      result.then(
        (v) => socket.write(encodeResponse({ id: req.id, result: v })),
        (e: Error) => socket.write(encodeResponse({ id: req.id, error: e.message })),
      );
    } else {
      socket.write(encodeResponse({ id: req.id, result }));
      if (req.method === 'close') socket.end();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    socket.write(encodeResponse({ id: req.id, error: message }));
  }
}

function dispatch(kernel: LSSKernel, req: RemoteRequest): unknown {
  const a = req.args;

  switch (req.method) {
    case 'ping':
      return 'pong';

    case 'apply': {
      const key = a['key'] as string;
      const valueB64 = a['value'] as string | null;
      const value = valueB64 === null
        ? null
        : new Uint8Array(Buffer.from(valueB64, 'base64'));
      const seq = kernel.apply(key, value);
      return { seq: String(seq) };
    }

    case 'get': {
      const key = a['key'] as string;
      const value = kernel.get(key);
      return {
        found: value !== undefined,
        value: value === undefined ? null : Buffer.from(value).toString('base64'),
      };
    }

    case 'checkpoint': {
      const seq = kernel.checkpoint();
      return { seq: String(seq) };
    }

    case 'rollback': {
      const seq = a['seq'] as string;
      kernel.rollback(BigInt(seq));
      return { seq };
    }

    case 'stats': {
      const s = kernel.stats();
      return {
        seq: String(s.seq),
        keyCount: s.keyCount,
        checkpointSeq: String(s.checkpointSeq),
        walBytes: s.walBytes,
      };
    }

    case 'keys': {
      return { keys: Array.from(kernel.keys()).sort() };
    }

    case 'current': {
      const entries: Record<string, string | null> = {};
      for (const [k, v] of kernel.current()) {
        entries[k] = v === null ? null : Buffer.from(v).toString('base64');
      }
      return { entries };
    }

    case 'close':
      return { bye: true };

    default:
      throw new Error(`Unknown method: ${req.method as string}`);
  }
}
