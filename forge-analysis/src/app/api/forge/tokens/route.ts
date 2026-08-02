// ============================================================
// Forge — API tokens (external access)
// ============================================================
// Create/list/revoke API tokens for external access to Forge.
// Tokens are SHA-256 hashed at rest (never stored in plaintext).
//
// GET  /api/forge/tokens            — list tokens (masked)
// POST /api/forge/tokens            — create token (returns plaintext once)
// DELETE /api/forge/tokens/[id]     — revoke token
// ============================================================
import type { NextRequest } from 'next/server';
import * as crypto from 'node:crypto';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  // Format: fk_<32 random hex chars>
  const random = crypto.randomBytes(16).toString('hex');
  return `fk_${random}`;
}

export async function GET(_req: NextRequest): Promise<Response> {
  try {
    const tokens = await db.apiToken.findMany({
      where: { revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        projectId: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return Response.json({ tokens });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json() as {
      name: string;
      projectId?: string;
      scopes?: string;
      expiresInSeconds?: number;
    };

    if (!body.name?.trim()) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const scopes = body.scopes ?? 'read';
    const plaintext = generateToken();
    const tokenHash = hashToken(plaintext);
    const prefix = plaintext.slice(0, 11) + '…';

    const expiresAt = body.expiresInSeconds
      ? new Date(Date.now() + body.expiresInSeconds * 1000)
      : null;

    const token = await db.apiToken.create({
      data: {
        name: body.name.trim(),
        tokenHash,
        prefix,
        projectId: body.projectId ?? null,
        scopes,
        expiresAt,
      },
    });

    // Return the plaintext token ONCE (never again).
    return Response.json({
      id: token.id,
      name: token.name,
      token: plaintext,  // only returned on creation
      prefix: token.prefix,
      scopes: token.scopes,
      message: 'Save this token — it won\'t be shown again.',
    }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
