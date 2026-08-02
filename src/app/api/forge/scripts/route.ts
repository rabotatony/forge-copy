// Forge — script library (list + create)
//
// Scripts are stored as Pipelines whose name is prefixed with `script:`
// and whose `config.customWorkflow` carries a single `run` step holding
// the user-authored code. The workflow's `env` field records the script
// language (SCRIPT_LANG) so the runner and UI can dispatch on it later.
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { saveCustomWorkflow } from '@/lib/forge/custom-workflow';
import type { CustomWorkflow } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SCRIPT_PREFIX = 'script:';

type ScriptLanguage = 'bash' | 'python' | 'node';

interface ScriptSummary {
  id: string;
  name: string;
  description: string;
  language: ScriptLanguage;
  code: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateScriptBody {
  name: string;
  description: string;
  language: ScriptLanguage;
  code: string;
  projectId: string;
}

interface PipelineRow {
  id: string;
  name: string;
  projectId: string;
  config: string;
  createdAt: Date;
  updatedAt: Date;
}

function isScriptLanguage(value: unknown): value is ScriptLanguage {
  return value === 'bash' || value === 'python' || value === 'node';
}

function decodeScript(row: PipelineRow): ScriptSummary | null {
  let config: { customWorkflow?: CustomWorkflow };
  try {
    config = JSON.parse(row.config);
  } catch {
    return null;
  }
  const workflow = config.customWorkflow;
  if (!workflow) return null;
  const step = workflow.steps[0];
  if (!step) return null;
  const rawLang = workflow.env?.SCRIPT_LANG;
  const language: ScriptLanguage = isScriptLanguage(rawLang) ? rawLang : 'bash';
  const name = row.name.startsWith(SCRIPT_PREFIX)
    ? row.name.slice(SCRIPT_PREFIX.length)
    : row.name;
  return {
    id: row.id,
    name,
    description: workflow.description ?? '',
    language,
    code: step.run,
    projectId: row.projectId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  try {
    const pipelines = await db.pipeline.findMany({
      where: { name: { startsWith: SCRIPT_PREFIX } },
      orderBy: { updatedAt: 'desc' },
    });
    const scripts: ScriptSummary[] = [];
    for (const p of pipelines) {
      const decoded = decodeScript(p);
      if (decoded) scripts.push(decoded);
    }
    return Response.json({ scripts });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateScriptBody>;
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }
    if (typeof body.projectId !== 'string' || body.projectId.trim() === '') {
      return Response.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (typeof body.code !== 'string' || body.code.trim() === '') {
      return Response.json({ error: 'code is required' }, { status: 400 });
    }
    if (!isScriptLanguage(body.language)) {
      return Response.json(
        { error: 'language must be one of: bash, python, node' },
        { status: 400 },
      );
    }
    const description = typeof body.description === 'string' ? body.description : '';
    const fullName = `${SCRIPT_PREFIX}${body.name}`;
    const workflow: CustomWorkflow = {
      name: fullName,
      description,
      steps: [{ name: 'run', run: body.code }],
      env: { SCRIPT_LANG: body.language },
    };
    const result = await saveCustomWorkflow(body.projectId, fullName, workflow);
    return Response.json({ id: result.id });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
