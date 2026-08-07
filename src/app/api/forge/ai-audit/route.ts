import type { NextRequest } from 'next/server';
import { detectAIText } from '@/../mini-services/ai-detector/ai-detector';
import { detectAICode } from '@/../mini-services/ai-detector/code-ai-detector';
import { detectAICSS } from '@/../mini-services/ai-detector/css-ai-detector';
import { auditProject, type ProjectFile } from '@/../mini-services/ai-detector/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * AI-Audit API route for Forge.
 *
 * POST /api/forge/ai-audit
 *
 * Body:
 *   { files: [{ path, content }], threshold?: number }
 *
 * Runs the AI-detection suite on the provided files and returns
 * a comprehensive authenticity report.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const files: ProjectFile[] = body.files;
    const threshold: number = body.threshold ?? 0.5;

    if (!files || !Array.isArray(files)) {
      return Response.json({ error: 'Missing files array' }, { status: 400 });
    }

    // Run the comprehensive audit
    const result = auditProject(files);

    // Add threshold-based flag
    const exceedsThreshold = result.overallScore >= threshold;

    return Response.json({
      ...result,
      threshold,
      exceedsThreshold,
      recommendation: exceedsThreshold
        ? 'Project shows significant AI-generated content. Recommend human review.'
        : 'Project appears authentic.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/forge/ai-audit
 * Returns info about the AI-audit capability.
 */
export async function GET() {
  return Response.json({
    capability: 'ai-audit',
    description: 'Detects AI-generated content in uploaded projects.',
    detectors: ['text', 'code', 'css'],
    usage: 'POST with { files: [{ path, content }], threshold?: number }',
  });
}