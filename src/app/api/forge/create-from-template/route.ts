// ============================================================
// Forge — create project from template
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';
import { detectProject } from '@/lib/forge/detector';
import { projectDir, extractDir, ensureDirs } from '@/lib/forge/storage';
import { PROJECT_TEMPLATES } from '@/lib/forge/templates-projects';
import { audit } from '@/lib/forge/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    ensureDirs();
    const body = await request.json() as { templateId: string; name?: string };

    const template = PROJECT_TEMPLATES.find(t => t.id === body.templateId);
    if (!template) {
      return Response.json({ error: `Unknown template: ${body.templateId}` }, { status: 404 });
    }

    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const dir = projectDir(projectId);
    const extract = extractDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(extract, { recursive: true });

    for (const [relPath, content] of Object.entries(template.files)) {
      const fullPath = path.join(extract, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }

    const detection = detectProject(extract);
    const projectName = (body.name || template.name)
      .replace(/[<>:"'`]/g, '')
      .slice(0, 200) || 'unnamed';

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
        fileName: `template-${template.id}`,
        extractedPath: extract,
        fileSize,
        fileCount,
        kind: detection.kind,
        detection: JSON.stringify(detection.detection),
      },
    });

    await audit('project.created', 'project', project.id, undefined, {
      name: project.name,
      kind: project.kind,
      template: template.id,
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
