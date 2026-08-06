// ============================================================
// Forge — Prisma client (dual-mode)
// ============================================================
// Local / dev / VPS : SQLite via DATABASE_URL (unchanged behavior).
// Cloudflare Workers: D1 via @prisma/adapter-d1 + OpenNext request
//                     context (env.DB binding from wrangler.jsonc).
//
// The client is created LAZILY (on first access) because on Workers
// the D1 binding is only available during request handling, not at
// module load. A lazy Proxy keeps the `db` export shape unchanged so
// the rest of the codebase keeps working without edits.
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

function createPrismaClient(): PrismaClient {
  if (isCloudflareWorkers()) {
    try {
      // Lazy require so local/dev never needs these packages installed.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaD1 } = require("@prisma/adapter-d1");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCloudflareContext } = require("@opennextjs/cloudflare");
      // Installed @opennextjs/cloudflare exports getCloudflareContext (the
      // older getRequestContext no longer exists). Sync form is fine here:
      // we only read the stable env.DB binding during request handling.
      const ctx = getCloudflareContext();
      // Wrap the binding with the SQL guard: Prisma's query compiler emits
      // OFFSET shapes that strict D1 rejects (see d1-guard.ts).
      const { guardD1 } = require("@/lib/forge/d1-guard") as { guardD1: <X>(x: X) => X };
      const adapter = new PrismaD1(guardD1((ctx.env as Record<string, unknown>).DB));
      return new PrismaClient({ adapter, log: ["error"] });
    } catch {
      // D1 unavailable — fall back to default client (SQLite).
      return new PrismaClient({ log: ["error"] });
    }
  }
  return new PrismaClient({ log: ["error"] });
}

let _db: PrismaClient | null = null;
function getDb(): PrismaClient {
  if (_db) return _db;
  if (globalForPrisma.prisma) {
    _db = globalForPrisma.prisma;
    return _db;
  }
  _db = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = _db;
  }
  return _db;
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
