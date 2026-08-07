// ============================================================
// Forge — Build Intelligence: project analysis
// GET  /api/forge/projects/[id]/analyze — capability analysis
// POST /api/forge/projects/[id]/analyze — same + audit trail
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import { db } from '@/lib/db';
import { ok, notFound, fail, serverError } from '@/lib/forge/response';
import { audit } from '@/lib/forge/audit';
import { extractDir } from '@/lib/forge/storage';
import { analyzeProject } from '@/lib/forge/analyzer';
import { preflightApk } from '@/lib/forge/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cap(ok: boolean) { return { ok, warnings: [] as string[], blockers: ok ? [] : ['workspace not on local disk'] }; }

function analysisFromDetection(det: Record<string, unknown>) {
  const caps = (det?.capabilities ?? {}) as Record<string, boolean>;
  const framework = (det?.framework as string) ?? 'unknown';
  return {
    framework,
    frameworkVersion: (det?.frameworkVersion as string | null) ?? null,
    language: (det?.language as string) ?? 'unknown',
    packageManager: 'unknown',
    packageName: null,
    appIdSuggestion: 'app',
    scripts: {},
    counts: { files: (det?.fileCount as number) ?? 0, codeFiles: 0, pages: 0, apiRoutes: 0 },
    nextConfig: { exists: false, file: null, output: null, hasEnvToggle: false, imagesUnoptimized: false, standalone: false },
    apiRoutes: [],
    pages: [],
    capabilities: { staticExport: cap(!!caps.static), apkWrap: cap(false), ssr: cap(!!caps.ssr) },
    hasCapacitor: false,
    hasMiddleware: false,
    usesNextImage: false,
    recommendedTargets: (caps.static ? ['web-static'] : []).concat(caps.ssr ? ['node-server'] : []),
    suggestions: ['Workspace lives in object storage on this runtime; showing stored detection.'],
  };
}

async function handle(id: string): Promise<Response> {
  const project = await db.project.findUnique({ where: { id }, select: { id: true, name: true, detection: true } });
  if (!project) return notFound('Project not found');
  const root = extractDir(id);
  let analysis;
  if (fs.existsSync(root)) {
    analysis = analyzeProject(root);
  } else {
    // Runtime without local fs (Workers): fall back to the detection stored at upload.
    let det: Record<string, unknown> = {};
    try { det = JSON.parse(project.detection || '{}'); } catch { det = {}; }
    analysis = analysisFromDetection(det);
  }
  return ok({ projectId: id, name: project.name, analysis, preflight: { apk: preflightApk(analysis) } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    return await handle(id);
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    await audit('project.analyze', 'project', id, 'user');
    return await handle(id);
  } catch (err) {
    return serverError(err);
  }
}
