// ============================================================
// Forge — API response helpers
// ============================================================
// Single source of truth for HTTP response shapes. Every Forge API
// route should use these helpers so the client can rely on a
// consistent contract:
//
//   • success:  { ok: true, data: T }            — 200 / 201
//   • error:    { ok: false, error: string }     — 4xx / 5xx
//
// (The legacy `{ error: ... }` shape is still tolerated by the
//  client's jsonOrThrow for backwards compatibility, but new code
//  should use ok()/created()/fail().)
// ============================================================
import { NextResponse } from "next/server";

export type ForgeJson = Record<string, unknown> | unknown[] | null;

export function ok<T extends ForgeJson>(data?: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data: data ?? null }, init);
}

export function created<T extends ForgeJson>(data?: T) {
  return NextResponse.json({ ok: true, data: data ?? null }, { status: 201 });
}

export function fail(error: string, status = 400, extra?: ForgeJson) {
  return NextResponse.json(
    { ok: false, error, ...(extra ?? {}) },
    { status },
  );
}

export function notFound(message = "Not found") {
  return fail(message, 404);
}

export function forbidden(message = "Forbidden") {
  return fail(message, 403);
}

export function unauthorized(message = "Unauthorized") {
  return fail(message, 401);
}

export function serverError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return fail(message, 500);
}
