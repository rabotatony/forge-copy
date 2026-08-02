// ============================================================
// Forge — AI Assistant (global, no project context)
// ============================================================
// Takes natural language and returns a structured action the UI
// can execute. Uses a keyword-based fast path first, falls back
// to LLM for complex queries.
//
// POST /api/forge/ai-assistant
//   body: { message: string, projects?: Array<{id,name,kind,fileName}> }
//   → { action: "navigate"|"run-workflow"|"answer", ... }
// ============================================================
import type { NextRequest } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Valid workflow keys for validation.
const VALID_WORKFLOWS = new Set([
  'install', 'build', 'test', 'lint', 'build-apk', 'docker-build',
  'npm-audit', 'security-scan', 'inspect', 'parse', 'bundle',
  'coverage', 'release', 'deploy-ssh', 'deploy-rsync', 'bundle-size',
]);

/**
 * Fast keyword-based intent detection. Avoids LLM call for common
 * phrases, making responses instant.
 */
function fastPath(message: string, projects: Array<{id:string;name:string;kind:string;fileName:string}> | undefined): {
  action: string; workflow?: string; projectId?: string; target?: string; text?: string;
} | null {
  const msg = message.toLowerCase().trim();

  // Question intents — ALWAYS fall through to LLM (don't match keywords).
  // This prevents "how do I add tests?" from triggering run-workflow: test.
  if (/^(how|what|why|when|where|who|which|can you|could you|would you|is|are|do|does|should|explain|tell me|what's|whats)\b/.test(msg)) {
    return null; // fall through to LLM
  }

  // Navigation intents.
  if (/^(show|list|view)?\s*(my\s*)?(projects?|home|dashboard)/.test(msg) || msg === 'home') {
    return { action: 'navigate', target: 'home' };
  }
  if (/^(upload|new project|add project)/.test(msg)) {
    return { action: 'navigate', target: 'upload' };
  }
  if (/^(docs?|help|documentation)/.test(msg)) {
    return { action: 'navigate', target: 'docs' };
  }

  // Workflow intents — only if projects exist.
  // Use imperative phrasing to avoid matching questions.
  const firstProject = projects?.[0];
  const projectId = firstProject?.id;

  const workflowMap: Array<{ regex: RegExp; workflow: string }> = [
    { regex: /\b(build|make|create|generate|ship)\b.*\b(apk|android|mobile)\b/, workflow: 'build-apk' },
    { regex: /\b(apk|android|mobile app)\b.*\b(build|make|create|generate|ship)\b/, workflow: 'build-apk' },
    { regex: /\b(run|execute|start)\b.*\b(test|tests|testing)\b/, workflow: 'test' },
    { regex: /\b(test|tests)\b.*\b(run|execute|start)\b/, workflow: 'test' },
    { regex: /\b(run|do|perform)\b.*\b(security|audit|vulnerab|cve)\b/, workflow: 'security-scan' },
    { regex: /\b(security|audit)\b.*\b(run|do|perform|scan)\b/, workflow: 'security-scan' },
    { regex: /\b(inspect|analyze|examine|explore)\b/, workflow: 'inspect' },
    { regex: /\b(build|make|create)\b.*\b(docker|container|image)\b/, workflow: 'docker-build' },
    { regex: /\b(docker|container)\b.*\b(build|make|create)\b/, workflow: 'docker-build' },
    { regex: /\b(run|execute|start)\b.*\b(build|compile)\b/, workflow: 'build' },
    { regex: /\b(run|execute|start)\b.*\b(lint|linter|eslint)\b/, workflow: 'lint' },
    { regex: /\b(run|execute|start)\b.*\b(install|deps|dependencies)\b/, workflow: 'install' },
    { regex: /\b(run|execute|start)\b.*\b(coverage)\b/, workflow: 'coverage' },
    { regex: /\b(create|make|cut|publish|ship)\b.*\b(release)\b/, workflow: 'release' },
    { regex: /\b(run|execute|start)\b.*\b(bundle|webpack)\b/, workflow: 'bundle-size' },
  ];

  // Also support simple one-word commands like "test", "build", "lint".
  const simpleCommands: Record<string, string> = {
    'test': 'test',
    'tests': 'test',
    'lint': 'lint',
    'build': 'build',
    'inspect': 'inspect',
    'install': 'install',
  };
  if (simpleCommands[msg]) {
    if (!projectId) {
      return { action: 'answer', text: `Upload a file first, then I can run "${simpleCommands[msg]}" for you.` };
    }
    return { action: 'run-workflow', workflow: simpleCommands[msg], projectId };
  }

  for (const { regex, workflow } of workflowMap) {
    if (regex.test(msg)) {
      if (!projectId) {
        return {
          action: 'answer',
          text: `Upload a file first, then I can run the "${workflow}" workflow for you.`,
        };
      }
      return { action: 'run-workflow', workflow, projectId };
    }
  }

  return null; // fall through to LLM
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json() as {
      message: string;
      projects?: Array<{ id: string; name: string; kind: string; fileName: string }>;
    };

    if (!body.message?.trim()) {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    // Try fast path first (instant, no LLM call).
    const fast = fastPath(body.message, body.projects);
    if (fast) {
      // Validate workflow if present.
      if (fast.workflow && !VALID_WORKFLOWS.has(fast.workflow)) {
        // Invalid workflow — fall through to LLM.
      } else {
        return Response.json(fast);
      }
    }

    const zai = await ZAI.create();

    const projectList = body.projects?.length
      ? body.projects.map(p => `- id: "${p.id}" | name: "${p.name}" | kind: ${p.kind} | file: ${p.fileName}`).join('\n')
      : '(no projects yet)';

    const systemPrompt = `You are Forge AI, an assistant for a self-hosted CI/CD system called Forge.
Forge lets users upload any file (ZIP, HTML, JS, etc.) and automatically detects what they want to build, then runs the right workflow.

The user's current projects:
${projectList}

CRITICAL RULES:
1. If the user wants to BUILD/SHIP/RUN something AND projects exist, ALWAYS use "run-workflow" with the FIRST project's id.
2. Only use "navigate: upload" when the user explicitly wants to upload a NEW file AND there are no projects yet.
3. Workflow mapping:
   - "apk"/"android"/"mobile" → "build-apk"
   - "test"/"testing" → "test"
   - "security"/"audit"/"vulnerab" → "security-scan"
   - "inspect"/"analyze" → "inspect"
   - "docker"/"container" → "docker-build"
   - "build"/"compile" → "build"
   - "lint" → "lint"
   - "install"/"deps" → "install"
   - "coverage" → "coverage"
   - "release"/"publish" → "release"
4. For questions (how, what, why), use "answer" with a concise 1-2 sentence response.

Valid workflow keys: ${Array.from(VALID_WORKFLOWS).join(', ')}

Respond with ONLY valid JSON:
{
  "action": "run-workflow" | "navigate" | "answer",
  "projectId": "<exact id from list>",
  "workflow": "<one of the valid keys>",
  "target": "home" | "upload" | "docs",
  "text": "..."
}

IMPORTANT: projectId MUST be the exact "id" value (e.g. "proj_xxx"), NOT the name.`;

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
        text: "I didn't understand that. Try: 'build an apk', 'run tests', or 'show my projects'.",
      });
    }

    let parsed: { action: string; target?: string; projectId?: string; workflow?: string; text?: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return Response.json({
        action: 'answer',
        text: "I had trouble understanding the response. Please rephrase and try again.",
      });
    }

    // Validate: if run-workflow, ensure workflow is valid.
    if (parsed.action === 'run-workflow' && parsed.workflow) {
      if (!VALID_WORKFLOWS.has(parsed.workflow)) {
        return Response.json({
          action: 'answer',
          text: `I don't recognize the workflow "${parsed.workflow}". Available: build-apk, test, security-scan, inspect, docker-build, build, lint, install, coverage, release.`,
        });
      }
      // If no projectId but projects exist, use the first one.
      if (!parsed.projectId && body.projects?.length) {
        parsed.projectId = body.projects[0]!.id;
      }
    }

    return Response.json(parsed);
  } catch (e) {
    return Response.json(
      {
        action: 'answer',
        text: `Sorry, I encountered an error. Please try again with a simpler request like "build an apk" or "run tests".`,
      },
      { status: 500 },
    );
  }
}
