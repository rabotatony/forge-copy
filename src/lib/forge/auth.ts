// ============================================================
// Forge — API token validation helper
// ============================================================
// Validates API tokens from the Authorization header.
// Usage in API routes:
//   import { validateApiToken } from '@/lib/forge/auth';
//   const auth = await validateApiToken(request);
//   if (!auth.valid) return Response.json({ error: 'Unauthorized' }, { status: 401 });
//   // auth.token has: id, name, scopes, projectId
// ============================================================
import * as crypto from 'node:crypto';
import { db } from '@/lib/db';

export interface ApiTokenInfo {
  id: string;
  name: string;
  scopes: string[];
  projectId: string | null;
}

export interface AuthResult {
  valid: boolean;
  token?: ApiTokenInfo;
  error?: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Validate the API token from the Authorization header.
 * Accepts: "Bearer fk_xxx" or "token fk_xxx" or just "fk_xxx"
 *
 * Returns { valid: false } if no token or invalid.
 * Returns { valid: true, token: {...} } if valid.
 */
export async function validateApiToken(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');

  if (!authHeader) {
    return { valid: false, error: 'No Authorization header' };
  }

  // Extract token from "Bearer fk_xxx" or "token fk_xxx" or "fk_xxx"
  let rawToken: string;
  if (authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7);
  } else if (authHeader.startsWith('token ')) {
    rawToken = authHeader.slice(6);
  } else {
    rawToken = authHeader;
  }

  // Must start with fk_
  if (!rawToken.startsWith('fk_')) {
    return { valid: false, error: 'Invalid token format' };
  }

  const tokenHash = hashToken(rawToken);

  // Look up the token.
  const token = await db.apiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      name: true,
      scopes: true,
      projectId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!token) {
    return { valid: false, error: 'Token not found' };
  }

  if (token.revokedAt) {
    return { valid: false, error: 'Token revoked' };
  }

  if (token.expiresAt && token.expiresAt < new Date()) {
    return { valid: false, error: 'Token expired' };
  }

  // Update lastUsedAt (fire-and-forget, don't block the request).
  void db.apiToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => { /* ignore */ });

  return {
    valid: true,
    token: {
      id: token.id,
      name: token.name,
      scopes: (token.scopes ?? '').split(',').map(s => s.trim()).filter(Boolean),
      projectId: token.projectId,
    },
  };
}

/**
 * Check if a token has a specific scope.
 */
export function hasScope(token: ApiTokenInfo | undefined, scope: string): boolean {
  if (!token) return false;
  if (token.scopes.includes('admin')) return true;
  return token.scopes.includes(scope);
}

/**
 * Check if a token can access a specific project.
 * Returns true if token is not project-scoped, or if it matches.
 */
export function canAccessProject(token: ApiTokenInfo | undefined, projectId: string): boolean {
  if (!token) return false;
  if (!token.projectId) return true; // null = all projects
  return token.projectId === projectId;
}
