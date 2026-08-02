// ============================================================
// Forge — download an artifact
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
): Promise<Response> {
  try {
    const { id, artifactId } = await params;

    const artifact = await db.artifact.findUnique({
      where: { id: artifactId },
    });
    if (!artifact || artifact.runId !== id) {
      return Response.json({ error: 'Artifact not found' }, { status: 404 });
    }
    if (!fs.existsSync(artifact.path)) {
      return Response.json({ error: 'Artifact file missing on disk' }, { status: 404 });
    }

    const nodeStream = fs.createReadStream(artifact.path);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': artifact.mime || 'application/octet-stream',
        'Content-Length': String(artifact.size),
        'Content-Disposition': `attachment; filename="${artifact.name.replace(/"/g, '_')}"`,
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
