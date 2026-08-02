// ============================================================
// Forge — AI Assistant (project-scoped)
// ============================================================
// Takes natural language + project context, returns a structured
// action. Knows which workflows are available for this project.
//
// POST /api/forge/projects/[id]/ai-assistant
//   body: { message: string }
//   → { action: "run-workflow"|"answer"|"navigate", workflow?, text? }
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { workflowsForKind } from '@/lib/forge/workflows';
import type { Detection, ProjectKind } from '@/lib/forge/detector';
import { WORKFLOW_PRESETS } from '@/lib/forge/presets';
import ZAI from 'z-ai-web-dev-sdk';

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

    let detection: Detection;
    try { detection = JSON.parse(project.detection) as Detection; }
    catch { detection = { type: 'unknown', hints: [] } as Detection; }
    const kind = (project.kind as ProjectKind) ?? 'unknown';

    // Get available workflows for this project.
    const available = workflowsForKind(kind, detection, project.extractedPath);
    const workflowList = available.map(w => `- ${w.key}: ${w.name} — ${w.description}`).join('\n');

    const presetList = WORKFLOW_PRESETS
      .filter(p => p.steps.every(s => available.some(w => w.key === s)))
      .map(p => `- ${p.id}: ${p.name} — ${p.description} (steps: ${p.steps.join(' → ')})`)
      .join('\n');

    const zai = await ZAI.create();

    const systemPrompt = `You are Forge AI, an assistant for the project "${project.name}" (kind: ${kind}).
This project has the following workflows available:
${workflowList}

Available presets (multi-workflow sequences):
${presetList}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "action": "run-workflow" | "run-preset" | "answer",
  "workflow": "build-apk",      // for run-workflow (must be from the list above)
  "presetId": "ship-apk",       // for run-preset (must be from the list above)
  "text": "..."                 // for answer (concise, 2-3 sentences)
}

Rules:
- Match the user's intent to the best workflow or preset.
- For "apk"/"android", prefer the "build-apk" workflow or "ship-apk" preset.
- For "full ci"/"quality", prefer a preset like "full-ci" or "quality-gate".
- For "security"/"audit", use "npm-audit" or "security-scan" or the "security-check" preset.
- For "test"/"coverage", use "test" or "coverage" or the "test-coverage" preset.
- For "deploy"/"ship", use deploy workflows or presets.
- For "inspect"/"analyze", use "inspect" or "deep-inspect" preset.
- If the request is ambiguous, use "answer" to clarify.
- Keep answers concise and actionable.`;

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: body.message },
      ],
      thinking: { type: 'disabled' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({
        action: 'answer',
        text: "I didn't understand that. Try: 'build an apk', 'run tests', or 'security audit'.",
      });
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      action: string;
      workflow?: string;
      presetId?: string;
      text?: string;
    };

    return Response.json(parsed);
  } catch (e) {
    return Response.json(
      {
        action: 'answer',
        text: `Sorry, I encountered an error: ${e instanceof Error ? e.message : 'unknown'}. Please try again.`,
      },
      { status: 500 },
    );
  }
}
