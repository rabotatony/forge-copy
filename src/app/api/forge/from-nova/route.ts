// ============================================================
// Forge — Nova bridge: ingest a generated app from Nova
// ============================================================
// Nova (prompt-to-reality engine) publishes its generated files
// here. Forge writes them into a fresh project workspace, runs
// detection + capability analysis, and returns everything the
// caller needs to continue the chain (blueprint > build > deploy).
//
// POST /api/forge/from-nova
//   {
//     name?: string,                 // project name (default: "nova-app")
//     prompt?: string,               // the originating Nova prompt (audit trail)
//     files: [{ path, content }]     // OR { "<path>": "<content>" } map
//     meta?: Record<string, unknown> // anything Nova wants to record
//   }
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';
import { detectProject } from '@/lib/forge/detector';
import { projectDir, extractDir, ensureDirs } from '@/lib/forge/storage';
import { analyzeProject } from '@/lib/forge/analyzer';
import { audit } from '@/lib/forge/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;   // 2MB per file
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB total

function safePath(rel: unknown): string | null {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 512) return null;
  if (rel.includes('\\')) return null; // backslash paths are rejected outright
  const norm = rel.replace(/\/+/g, '/');
  if (norm.startsWith('/')) return null;
  const parts = norm.split('/');
  if (parts.some((p) => p === '..' || p === '')) return null;
  return parts.join('/');
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    ensureDirs();
    const body = await request.json() as {
      name?: string;
      prompt?: string;
      files?: unknown;
      meta?: Record<string, unknown>;
    };

    // --- normalize files (array or map form) ---
    const incoming: Array<{ path: string; content: string }> = [];
    if (Array.isArray(body.files)) {
      for (const f of body.files) {
        if (f && typeof f === 'object' && 'path' in (f as Record<string, unknown>)) {
          const o = f as { path: unknown; content: unknown };
          incoming.push({ path: String(o.path ?? ''), content: String(o.content ?? '') });
        }
      }
    } else if (body.files && typeof body.files === 'object') {
      for (const [p, c] of Object.entries(body.files as Record<string, unknown>)) {
        incoming.push({ path: p, content: String(c ?? '') });
      }
    }

    if (incoming.length === 0) {
      return Response.json({ error: 'No files provided. Send files as [{ path, content }] or { path: content }.' }, { status: 400 });
    }
    if (incoming.length > MAX_FILES) {
      return Response.json({ error: 'Too many files (max ' + MAX_FILES + ').' }, { status: 400 });
    }

    // --- validate + sanitize paths, enforce size limits ---
    let totalBytes = 0;
    const writes: Array<{ rel: string; content: string }> = [];
    for (const f of incoming) {
      const rel = safePath(f.path);
      if (!rel) {
        return Response.json({ error: 'Unsafe or invalid file path: ' + JSON.stringify(f.path) }, { status: 400 });
      }
      const bytes = Buffer.byteLength(f.content, 'utf8');
      if (bytes > MAX_FILE_BYTES) {
        return Response.json({ error: 'File too large: ' + rel + ' (max 2MB).' }, { status: 400 });
      }
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return Response.json({ error: 'Total payload too large (max 20MB).' }, { status: 400 });
      }
      writes.push({ rel, content: f.content });
    }

    // --- create project workspace ---
    const projectId = 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const dir = projectDir(projectId);
    const extract = extractDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(extract, { recursive: true });

    for (const w of writes) {
      const full = path.join(extract, w.rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, w.content);
    }

    // --- detect + analyze ---
    const detection = detectProject(extract);
    let analysis = null;
    try {
      analysis = analyzeProject(extract);
    } catch {
      // analysis is best-effort; detection alone still lets the UI continue
    }

    const projectName = (typeof body.name === 'string' ? body.name : '')
      .replace(/[<>:"']/g, '')
      .slice(0, 200) || 'nova-app';

    let fileCount = 0;
    let fileSize = 0;
    const countFiles = (d: string): void => {
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) countFiles(full);
          else if (e.isFile()) {
            fileCount++;
            try { fileSize += fs.statSync(full).size; } catch {}
          }
        }
      } catch {}
    };
    countFiles(extract);

    const project = await db.project.create({
      data: {
        id: projectId,
        name: projectName,
        fileName: 'nova-import',
        extractedPath: extract,
        fileSize,
        fileCount,
        kind: detection.kind,
        detection: JSON.stringify(detection.detection),
      },
    });

    const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 2000) : undefined;
    await audit('project.created', 'project', project.id, undefined, {
      name: project.name,
      kind: project.kind,
      source: 'nova',
      prompt,
      novaMeta: body.meta && typeof body.meta === 'object' ? body.meta : undefined,
    });

    return Response.json({
      project: {
        id: project.id,
        name: project.name,
        fileName: project.fileName,
        kind: project.kind,
        fileSize: project.fileSize,
        fileCount: project.fileCount,
        createdAt: project.createdAt.toISOString(),
        runCount: 0,
        lastRunStatus: null,
      },
      analysis,
      nextSteps: [
        'Open the project Overview tab - BuildIntelligencePanel shows detected capabilities.',
        'Apply the recommended blueprint (one click) to write export/APK config.',
        'Run the build workflow, then publish artifacts from the Artifacts panel.',
      ],
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
