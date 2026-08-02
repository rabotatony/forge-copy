// ============================================================
// Forge — secrets manager
// ============================================================
// AES-256-GCM encryption at rest. The encryption key is derived from
// the FORGE_SECRET_KEY env var (or a stable fallback).
// Secrets are automatically masked in log output.
// ============================================================

import * as crypto from 'node:crypto';
import { db } from '@/lib/db';

const ALGO = 'aes-256-gcm';

// Derive a 32-byte key from the env var (or a stable fallback for dev).
function getKey(): Buffer {
  const raw = process.env.FORGE_SECRET_KEY ?? 'forge-dev-key-do-not-use-in-production-change-me';
  return crypto.createHash('sha256').update(raw).digest();
}

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64
}

export function encrypt(plaintext: string): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(value: EncryptedValue): string {
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

export async function setSecret(projectId: string, key: string, value: string): Promise<void> {
  const enc = encrypt(value);
  await db.secret.upsert({
    where: { projectId_key: { projectId, key } },
    create: { projectId, key, ...enc },
    update: { ...enc },
  });
}

export async function getSecret(projectId: string, key: string): Promise<string | null> {
  const row = await db.secret.findUnique({
    where: { projectId_key: { projectId, key } },
  });
  if (!row) return null;
  return decrypt({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag });
}

export async function getSecrets(projectId: string, keys: string[]): Promise<Record<string, string>> {
  const rows = await db.secret.findMany({
    where: { projectId, key: { in: keys } },
  });
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = decrypt({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag });
  }
  return result;
}

export async function getAllSecrets(projectId: string): Promise<Record<string, string>> {
  const rows = await db.secret.findMany({ where: { projectId } });
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = decrypt({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag });
  }
  return result;
}

export async function listSecrets(projectId: string): Promise<{ id: string; key: string; createdAt: Date; updatedAt: Date }[]> {
  const rows = await db.secret.findMany({
    where: { projectId },
    orderBy: { key: 'asc' },
  });
  return rows.map(r => ({ id: r.id, key: r.key, createdAt: r.createdAt, updatedAt: r.updatedAt }));
}

export async function deleteSecret(projectId: string, key: string): Promise<void> {
  await db.secret.deleteMany({ where: { projectId, key } });
}

// ---------------------------------------------------------------------------
// Env vars (non-secret)
// ---------------------------------------------------------------------------

export async function setEnvVar(projectId: string, key: string, value: string): Promise<void> {
  await db.envVar.upsert({
    where: { projectId_key: { projectId, key } },
    create: { projectId, key, value },
    update: { value },
  });
}

export async function getEnvVars(projectId: string): Promise<Record<string, string>> {
  const rows = await db.envVar.findMany({ where: { projectId } });
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export async function listEnvVars(projectId: string): Promise<{ id: string; key: string; value: string }[]> {
  return db.envVar.findMany({ where: { projectId }, orderBy: { key: 'asc' } });
}

export async function deleteEnvVar(projectId: string, key: string): Promise<void> {
  await db.envVar.deleteMany({ where: { projectId, key } });
}

// ---------------------------------------------------------------------------
// Log masking
// ---------------------------------------------------------------------------

/**
 * Mask all known secret values in a text string.
 * Replaces each occurrence with `***`.
 */
export function maskSecrets(text: string, secrets: Record<string, string>): string {
  let result = text;
  for (const value of Object.values(secrets)) {
    if (value && value.length > 0) {
      // Escape regex special chars.
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), '***');
    }
  }
  return result;
}

/**
 * Build the environment object for a child process: injects project env vars
 * + requested secrets + forge-internal vars.
 */
export async function buildProcessEnv(
  projectId: string,
  options: { secrets?: string[]; extraEnv?: Record<string, string>; projectRoot: string },
): Promise<Record<string, string>> {
  const envVars = await getEnvVars(projectId);
  const secrets = options.secrets
    ? await getSecrets(projectId, options.secrets)
    : {};
  return {
    ...process.env,
    ...envVars,
    ...secrets,
    ...options.extraEnv,
    FORGE_PROJECT_ROOT: options.projectRoot,
    FORGE: '1',
    CI: 'true',
    FORCE_COLOR: '0',
  };
}
