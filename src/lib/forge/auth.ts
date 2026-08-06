// ============================================================
// Forge — API token validation (tokens + cookie sessions)
// ============================================================
// Credentials accepted from:
//   • Authorization: Bearer fk_xxx | token fk_xxx | fk_xxx
//   • Cookie: forge_session=fk_xxx   (set by /api/forge/auth/login)
//
// Usage in API routes:
//   import { authenticate } from '@/lib/forge/auth';
//   const auth = await authenticate(request);
//   if (!auth.valid) return Response.json({ error: 'Unauthorized' }, { status: 401 });
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

/** Extract a raw fk_ token from Authorization header or forge_session cookie. */
export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (authHeader) {
    let raw = authHeader.trim();
    if (raw.startsWith('Bearer ')) raw = raw.slice(7).trim();
    else if (raw.startsWith('token ')) raw = raw.slice(6).trim();
    if (raw.startsWith('fk_')) return raw;
  }
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === 'forge_session') {
        const v = decodeURIComponent(rest.join('='));
        if (v.startsWith('fk_')) return v;
      }
    }
  }
  return null;
}

/** Validate a raw fk_ token against the DB. */
export async function validateRawToken(rawToken: string): Promise<AuthResult> {
  if (!rawToken.startsWith('fk_')) {
    return { valid: false, error: 'Invalid token format' };
  }
  const tokenHash = hashToken(rawToken);
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

  if (!token) return { valid: false, error: 'Token not found' };
  if (token.revokedAt) return { valid: false, error: 'Token revoked' };
  if (token.expiresAt && token.expiresAt < new Date()) return { valid: false, error: 'Token expired' };

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

/** Full request authentication: header OR cookie. */
export async function authenticate(request: Request): Promise<AuthResult> {
  const raw = extractToken(request);
  if (!raw) return { valid: false, error: 'No credentials (Authorization header or forge_session cookie)' };
  return validateRawToken(raw);
}

/** Backward-compatible alias. */
export async function validateApiToken(request: Request): Promise<AuthResult> {
  return authenticate(request);
}

/** Check if a token has a specific scope. Admin passes everything. */
export function hasScope(token: ApiTokenInfo | undefined, scope: string): boolean {
  if (!token) return false;
  if (token.scopes.includes('admin')) return true;
  return token.scopes.includes(scope);
}

/** Check if a token can access a specific project (null projectId = all). */
export function canAccessProject(token: ApiTokenInfo | undefined, projectId: string): boolean {
  if (!token) return false;
  if (!token.projectId) return true;
  return token.projectId === projectId;
}
