// ============================================================
// Forge — D1 SQL guard
// ============================================================
// Prisma's query compiler emits SQLite that strict D1 rejects:
//
//   1. `... OFFSET ?` with NO LIMIT at all (count / aggregates)
//   2. `... OFFSET ? LIMIT ?` — OFFSET before LIMIT
//      (SQLite requires LIMIT to come first)
//
// The D1 adapter swallows the syntax errors and returns empty
// results, so model queries fail silently while $queryRaw seems
// fine. This guard rewrites SQL at the binding boundary, before
// PrismaD1 ever touches the database.
// ============================================================

export function rewriteD1Sql(sql: string): string {
  if (typeof sql !== "string" || !sql) return sql;
  let s = sql;

  // Pass 1: normalize `OFFSET a LIMIT b` -> `LIMIT b OFFSET a`.
  s = s.replace(
    /\bOFFSET\s+([?\d]+)\s+LIMIT\s+([?\d]+)/gi,
    (_m: string, off: string, lim: string) => `LIMIT ${lim} OFFSET ${off}`,
  );

  // Pass 2: `OFFSET` with no LIMIT anywhere in the statement ->
  // prepend LIMIT -1 (SQLite: unlimited).
  if (/\bOFFSET\b/i.test(s) && !/\bLIMIT\b/i.test(s)) {
    s = s.replace(/\bOFFSET\b/gi, "LIMIT -1 OFFSET");
  }

  return s;
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Wrap a D1 binding so every prepared statement passes through
 * rewriteD1Sql. PrismaD1 builds all its statements via prepare(),
 * so this single choke point covers queries, batches and exec.
 */
export function guardD1<T>(rawDb: T): T {
  const dbRecord = rawDb as unknown as Record<string | symbol, unknown>;
  return new Proxy(rawDb, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => (dbRecord.prepare as AnyFn)(rewriteD1Sql(sql));
      }
      if (prop === "exec") {
        return (sql: string) => (dbRecord.exec as AnyFn)(rewriteD1Sql(sql));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as AnyFn).bind(target) : value;
    },
  });
}
