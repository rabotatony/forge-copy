// ============================================================
// Forge — status badge (SVG)
// ============================================================
// Returns an SVG badge showing the project's last run status,
// suitable for embedding in a README or external page.
//
// GET /api/forge/projects/[id]/badge
//   ?workflow=build   (optional: filter by workflow key)
//   → image/svg+xml
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLORS = {
  success: '#10b981',
  failed: '#ef4444',
  running: '#f59e0b',
  canceled: '#6b7280',
  queued: '#6b7280',
  waiting_approval: '#f59e0b',
  unknown: '#6b7280',
} as const;

const LABELS = {
  success: 'passing',
  failed: 'failing',
  running: 'running',
  canceled: 'canceled',
  queued: 'queued',
  waiting_approval: 'pending',
  unknown: 'none',
} as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const workflowFilter = url.searchParams.get('workflow');

    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return new Response(svgBadge('forge', 'not found', COLORS.unknown), {
        headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' },
        status: 404,
      });
    }

    // Find the most recent run (optionally filtered by workflow).
    const where: { projectId: string; workflow?: string } = { projectId: id };
    if (workflowFilter) where.workflow = workflowFilter;

    const lastRun = await db.run.findFirst({
      where,
      orderBy: { startedAt: 'desc' },
      select: { status: true, workflow: true, exitCode: true },
    });

    const status = lastRun?.status ?? 'unknown';
    const color = COLORS[status as keyof typeof COLORS] ?? COLORS.unknown;
    const label = workflowFilter ?? 'forge';
    const value = LABELS[status as keyof typeof LABELS] ?? 'unknown';

    const svg = svgBadge(label, value, color);

    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml',
        'cache-control': 'no-store, max-age=0',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return new Response(svgBadge('forge', 'error', COLORS.failed), {
      headers: { 'content-type': 'image/svg+xml' },
      status: 500,
    });
  }
}

/**
 * Generate a shields.io-style SVG badge.
 * Format: [label | value] with rounded corners.
 */
function svgBadge(label: string, value: string, color: string): string {
  // Estimate text widths (monospace approximation).
  const labelWidth = Math.max(label.length * 6.5 + 10, 30);
  const valueWidth = Math.max(value.length * 6.5 + 10, 30);
  const totalWidth = labelWidth + valueWidth;
  const height = 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#333" d="M0 0h${labelWidth}v${height}H0z"/>
    <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v${height}H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${totalWidth}v${height}H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(value)}</text>
  </g>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
