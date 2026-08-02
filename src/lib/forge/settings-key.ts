// ============================================================
// Forge — shared encryption key for settings (.forge-settings.json)
// ============================================================
// Single source of truth for the FORGE_ENCRYPTION_KEY used by the
// settings route + github.ts + experiments. Mirrors the production
// guard in secrets.ts: refuses to run in production without an
// explicit key (the old code silently fell back to a publicly-known
// default key, leaking the GitHub token).
// ============================================================

import * as crypto from "node:crypto";

let _cachedKey: Buffer | null = null;

/**
 * Get the 32-byte AES-256 key for .forge-settings.json encryption.
 *
 * In production: throws if FORGE_ENCRYPTION_KEY is unset (refuses to
 * run with the public default key — the GitHub token would be
 * decryptable by anyone reading the source).
 *
 * In dev: falls back to a known dev-only key with a loud warning.
 */
export function getSettingsEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const raw = process.env.FORGE_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FORGE_ENCRYPTION_KEY is not set. Refusing to run in production without an explicit encryption key (the GitHub token would be encrypted with a public default key).",
      );
    }
    console.warn(
      "[forge:settings] FORGE_ENCRYPTION_KEY not set — using insecure dev fallback. Set FORGE_ENCRYPTION_KEY in production.",
    );
    _cachedKey = Buffer.from("forge-default-encryption-key-change-me-32b".padEnd(32, "0").slice(0, 32));
    return _cachedKey;
  }
  if (raw.length < 16) {
    throw new Error("FORGE_ENCRYPTION_KEY must be at least 16 characters long.");
  }
  // Derive a stable 32-byte key via SHA-256. The old code used
  // `padEnd(32, "0").slice(0, 32)` which for a short key like "my-key"
  // produced only 6 non-zero bytes — drastically reducing the keyspace.
  // SHA-256 spreads the entropy across all 32 bytes.
  _cachedKey = crypto.createHash("sha256").update(raw).digest();
  return _cachedKey!;
}

/**
 * Convenience: get the key as a base64 string. The caller does
 * `Buffer.from(ENCRYPTION_KEY, "base64")` to get the 32-byte key
 * back. Base64 is ASCII-safe (no multi-byte utf8 issues) and
 * round-trips losslessly.
 *
 * IMPORTANT: callers MUST pass "base64" as the encoding to
 * Buffer.from() — the default is utf8 which would produce a wrong
 * length.
 */
export function getSettingsEncryptionKeyString(): string {
  return getSettingsEncryptionKey().toString("base64");
}
