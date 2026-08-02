// ============================================================
// Forge — AI auto-script fallback
// ============================================================
// When the AI assistant can't find a matching workflow, it
// automatically generates a script using the LLM and runs it.
// This is the "Gumloop killer" — the system creates its own
// tools when it doesn't have them.
//
// POST /api/forge/projects/[id]/auto-script
//   body: { message: string }
//   → { action: "generated-and-ran", script, description, runId }
// ============================================================
import type { NextRequest } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import { workflowsForKind } from '@/lib/forge/workflows';
import { saveCustomWorkflow, runCustomWorkflow } from '@/lib/forge/custom-workflow';
import type { Detection, ProjectKind } from '@/lib/forge/detector';
import type { CustomWorkflowStep, CustomWorkflowStepLanguage } from '@/lib/forge/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json() as { message: string };

    if (!body.message?.trim()) {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

    // Check if any existing workflow matches the request.
    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: 'unknown', hints: [] } as Detection; }
    const kind = (project.kind as ProjectKind) ?? 'unknown';
    const available = workflowsForKind(kind, detection, project.extractedPath);
    const availableKeys = new Set(available.map(w => w.key));

    // Simple keyword check — does any workflow match?
    const msg = body.message.toLowerCase();
    const workflowKeywords: Record<string, string[]> = {
      'install': ['install', 'deps', 'dependencies'],
      'build': ['build', 'compile', 'make'],
      'test': ['test', 'tests', 'testing'],
      'lint': ['lint', 'eslint', 'linting'],
      'inspect': ['inspect', 'analyze', 'examine', 'explore'],
      'build-apk': ['apk', 'android', 'mobile'],
      'docker-build': ['docker', 'container', 'image'],
      'npm-audit': ['audit', 'vulnerab', 'cve'],
      'security-scan': ['security', 'scan'],
      'coverage': ['coverage'],
      'release': ['release', 'publish', 'ship'],
      'bundle-size': ['bundle size', 'bundle-size'],
      'parse': ['parse', 'ast'],
      'bundle': ['bundle', 'webpack'],
    };

    let hasWorkflow = false;
    for (const [key, keywords] of Object.entries(workflowKeywords)) {
      if (availableKeys.has(key) && keywords.some(kw => msg.includes(kw))) {
        hasWorkflow = true;
        break;
      }
    }

    // If a workflow exists, tell the user to use it instead.
    if (hasWorkflow) {
      return Response.json({
        action: 'workflow-exists',
        message: 'An existing workflow can handle this request. Use the AI assistant or workflow catalog.',
      });
    }

    // No workflow matches — GENERATE A SCRIPT automatically.
    const zai = await ZAI.create();

    const systemPrompt = `You are a scripting expert working inside Forge, a CI/CD system.
The user wants to do something that no built-in workflow can handle.
Generate a bash script that accomplishes their request.

Project context:
- Name: ${project.name}
- Kind: ${project.kind}
- Files: ${project.fileCount}
- Path: ${project.extractedPath}

Available workflows (already exist, don't duplicate): ${Array.from(availableKeys).join(', ')}

Rules:
1. Output ONLY the script code, no markdown, no explanation
2. Start with #!/bin/bash
3. The script runs in the project root directory
4. Make it robust (check for files before operating)
5. End with echo "DONE" on success

After the script, on a new line, write:
---DESCRIPTION---
Followed by a one-line description of what the script does.`;

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: body.message },
      ],
      thinking: { type: 'disabled' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';

    // Parse script + description.
    let script = raw;
    let description = 'Auto-generated script';
    const descSplit = raw.indexOf('---DESCRIPTION---');
    if (descSplit !== -1) {
      script = raw.slice(0, descSplit).trim();
      description = raw.slice(descSplit + '---DESCRIPTION---'.length).trim().split('\n')[0] ?? description;
    }

    // Strip markdown fences if present.
    script = script.replace(/^```\w*\n?/m, '').replace(/```\s*$/m, '').trim();

    // Ensure shebang.
    if (!script.startsWith('#!/bin/bash')) {
      script = '#!/bin/bash\n' + script;
    }

    // Detect the interpreter from the shebang line so the custom-workflow
    // runner uses the right one. Falls back to 'bash' for everything else.
    const detectedLanguage = detectLanguageFromShebang(script);

    // Build the auto-generated step. Only set `language` when it's not the
    // default ('bash') so the JSON stays tidy.
    const autoStep: CustomWorkflowStep = { name: 'auto-generated', run: script };
    if (detectedLanguage !== 'bash') autoStep.language = detectedLanguage;

    // Create a custom workflow with the generated script.
    const wfName = `auto:${body.message.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '-')}`;
    const customWf = await saveCustomWorkflow(id, wfName, {
      name: wfName,
      description,
      steps: [autoStep],
    });

    // Run it immediately.
    const runId = await runCustomWorkflow(id, {
      name: wfName,
      description,
      steps: [autoStep],
    }, { trigger: 'auto', label: `Auto: ${description}` });

    return Response.json({
      action: 'generated-and-ran',
      script,
      description,
      workflowId: customWf.id,
      runId,
      message: `No built-in workflow found. Generated and ran a custom script: ${description}`,
    });
  } catch (e) {
    return Response.json({
      action: 'error',
      error: e instanceof Error ? e.message : String(e),
      message: 'Failed to generate and run script.',
    }, { status: 500 });
  }
}

/**
 * Detect the interpreter language from a script's shebang line.
 *
 * Recognizes:
 *   #!/usr/bin/env node        → 'node'
 *   #!/usr/bin/env python3     → 'python'
 *   #!/usr/bin/env python      → 'python'
 *   #!/usr/bin/env ruby        → 'ruby'
 *   #!/usr/bin/python3         → 'python'
 *   #!/usr/bin/ruby            → 'ruby'
 *   #!/usr/bin/env bash        → 'bash'
 *   #!/bin/bash                → 'bash'
 *   #!/bin/sh                  → 'bash'
 *   (anything else / no shebang) → 'bash'
 *
 * Only the FIRST line is inspected. Matching is case-insensitive.
 */
function detectLanguageFromShebang(script: string): CustomWorkflowStepLanguage {
  const firstLine = script.split('\n', 1)[0] ?? '';
  if (!firstLine.startsWith('#!')) return 'bash';
  const line = firstLine.toLowerCase();

  // `env <interpreter>` form (most portable, recommended).
  const envMatch = line.match(/^#!\s*\/usr\/bin\/env\s+(\S+)/);
  if (envMatch) {
    const interp = envMatch[1]!;
    if (interp === 'node') return 'node';
    if (interp === 'python' || interp === 'python3' || interp === 'python2') return 'python';
    if (interp === 'ruby') return 'ruby';
    return 'bash'; // bash, sh, zsh, etc.
  }

  // Direct path form: /usr/bin/python3, /usr/bin/ruby, etc.
  if (/python[23]?$/.test(line)) return 'python';
  if (/ruby\d*$/.test(line)) return 'ruby';
  if (/\bnode\b/.test(line)) return 'node';

  return 'bash';
}
