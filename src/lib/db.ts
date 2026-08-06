// ============================================================
// Forge — Prisma client (dual-mode)
// ============================================================
// Local / dev / VPS : SQLite via DATABASE_URL.
// Cloudflare Workers: D1 via @prisma/adapter-d1 + OpenNext request
//                     context (env.DB binding, SQL-guarded).
//
// ROBUST CACHING: on Workers we only cache a client once it is a
// real D1-connected client. If construction falls back to the local
// SQLite client (context not ready / threw), we DO NOT cache it, so
// the next call retries and picks up the D1 binding once available.
// This kills the intermittent "project not found" bug caused by a
// broken local-SQLite client getting cached for the isolate.
// ============================================================
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function isCloudflareWorkers(): boolean {
  if (typeof process !== "undefined" && process.env?.FORGE_RUNTIME === "cloudflare") {
    return true;
  }
  try {
    const g = globalThis as Record<string, unknown>;
    if (typeof g.caches !== "undefined" && typeof (g.caches as Record<string, unknown>).default !== "undefined") {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

type CreateResult = { client: PrismaClient; isD1: boolean };

function createPrismaClient(): CreateResult {
  if (isCloudflareWorkers()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaD1 } = require("@prisma/adapter-d1");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCloudflareContext } = require("@opennextjs/cloudflare");
      const { guardD1 } = require("@/lib/forge/d1-guard") as { guardD1: <X>(x: X) => X };
      const ctx = getCloudflareContext();
      const DB = (ctx.env as Record<string, unknown>).DB;
      if (!DB) throw new Error("no DB binding");
      const adapter = new PrismaD1(guardD1(DB));
      return { client: new PrismaClient({ adapter, log: ["error"] }), isD1: true };
    } catch {
      // D1/context not ready — return a local client for THIS call only.
      return { client: new PrismaClient({ log: ["error"] }), isD1: false };
    }
  }
  return { client: new PrismaClient({ log: ["error"] }), isD1: false };
}

let _db: PrismaClient | null = null;
let _dbGood = false;

function getDb(): PrismaClient {
  if (_db && _dbGood) return _db;

  const { client, isD1 } = createPrismaClient();

  if (isCloudflareWorkers()) {
    if (isD1) {
      _db = client;
      _dbGood = true;
    } else {
      // Do NOT cache a broken (local-fallback) client — retry next call.
      _db = null;
      _dbGood = false;
    }
    return client;
  }

  // Local / dev: cache normally.
  _db = client;
  _dbGood = true;
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

// Lazy proxy so existing `db.project...` / `db.$transaction(...)` keep working.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, prop) {
    const client = getDb();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});
