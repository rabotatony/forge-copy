// ============================================================
// Forge — project upload endpoint
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { extractZip, findProjectRoot } from '@/lib/forge/zip';
import { detectProject } from '@/lib/forge/detector';
import { projectDir, extractDir, sourceZipPath, ensureDirs } from '@/lib/forge/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_SIZE = 200 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  try {
    ensureDirs();
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return Response.json({ error: 'File too large' }, { status: 413 });
    }

    const fileName = file.name;
    const lowerName = fileName.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const dir = projectDir(projectId);
    const extract = extractDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(extract, { recursive: true });

    let detectedRoot: string;

    if (lowerName.endsWith('.zip')) {
      const tmpZip = path.join(dir, '__upload.zip');
      fs.writeFileSync(tmpZip, buffer);
      try {
        await extractZip(tmpZip, extract);
        detectedRoot = findProjectRoot(extract);
      } finally {
        try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
      }
      fs.writeFileSync(sourceZipPath(projectId), buffer);
    } else if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz') || lowerName.endsWith('.tar')) {
      const tmpTar = path.join(dir, '__upload.tar');
      fs.writeFileSync(tmpTar, buffer);
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('tar', ['-xf', tmpTar, '-C', extract]);
          child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
          child.on('error', reject);
        });
        detectedRoot = findProjectRoot(extract);
      } finally {
        try { fs.unlinkSync(tmpTar); } catch { /* ignore */ }
      }
      fs.writeFileSync(sourceZipPath(projectId), buffer);
    } else {
      fs.writeFileSync(path.join(extract, fileName), buffer);
      detectedRoot = extract;
      fs.writeFileSync(sourceZipPath(projectId), buffer);
    }

    const detection = detectProject(detectedRoot);
    const baseName = fileName.replace(/\.(zip|tar\.gz|tgz|tar|apk)$/i, '');
    const projectName = baseName || fileName;

    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv', '.cache']);
    let fileCount = 0;
    let fileSize = 0;
    const visit = (d: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) visit(full);
        else if (e.isFile()) {
          fileCount++;
          try { fileSize += fs.statSync(full).size; } catch { /* ignore */ }
        }
      }
    };
    visit(detectedRoot);

    const project = await db.project.create({
      data: {
        id: projectId,
        name: projectName,
        fileName,
        extractedPath: detectedRoot,
        fileSize,
        fileCount,
        kind: detection.kind,
        detection: JSON.stringify(detection.detection),
      },
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
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
