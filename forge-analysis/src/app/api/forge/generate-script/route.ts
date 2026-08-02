// ============================================================
// Forge — AI Script Generator
// ============================================================
// Takes a natural language request and generates a working
// bash/python/node script using the LLM. Like Gumloop's bot
// but integrated with Forge — when a projectId is supplied,
// the generator is given project context (kind, fileCount,
// detection) so it can produce a script tailored to that
// project.
//
// POST /api/forge/generate-script
//   body: { message: string, projectId?: string, language?: "bash" | "python" | "node" }
//   → { script: string, language: string, filename: string, description: string }
// ============================================================
import type { NextRequest } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ScriptLanguage = 'bash' | 'python' | 'node';

const VALID_LANGUAGES: ReadonlySet<ScriptLanguage> = new Set([
  'bash',
  'python',
  'node',
]);

const FILENAME_BY_LANGUAGE: Readonly<Record<ScriptLanguage, string>> = {
  bash: 'script.sh',
  python: 'script.py',
  node: 'script.js',
};

const SHEBANG_BY_LANGUAGE: Readonly<Record<ScriptLanguage, string>> = {
  bash: '#!/bin/bash',
  python: '#!/usr/bin/env python3',
  node: '#!/usr/bin/env node',
};

const DESCRIPTION_DELIMITER = '---DESCRIPTION---';

interface ProjectContext {
  name: string;
  kind: string;
  fileCount: number;
  detection: string;
}

/**
 * Fetch a project's context fields from the DB. Returns null if
 * the project doesn't exist (caller decides how to handle).
 */
async function fetchProjectContext(projectId: string): Promise<ProjectContext | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      kind: true,
      fileCount: true,
      detection: true,
    },
  });
  if (!project) return null;
  return {
    name: project.name,
    kind: project.kind,
    fileCount: project.fileCount,
    detection: project.detection,
  };
}

/**
 * Build the system prompt. Always includes the base scripting
 * instructions; appends a project-context line when available.
 */
function buildSystemPrompt(language: ScriptLanguage, project: ProjectContext | null): string {
  const shebang = SHEBANG_BY_LANGUAGE[language];

  const base = `You are a scripting expert. Generate a single executable script that accomplishes the user's request. Output ONLY the script code, no markdown, no explanation. Start with the shebang line (#!/bin/bash or #!/usr/bin/env python3 or #!/usr/bin/env node).

The script MUST be written in ${language} and MUST start with the shebang line \`${shebang}\`.

After the script, on a new line by itself, output exactly \`${DESCRIPTION_DELIMITER}\`, then on the next line output a single one-line description of what the script does (no markdown, no quotes, max ~120 characters).`;

  if (project) {
    return `${base}

The project is a ${project.kind} project with ${project.fileCount} files. Detected: ${project.detection}.`;
  }

  return base;
}

/**
 * Parse the raw LLM response into { script, description }.
 * Splits on the first occurrence of the delimiter on its own line.
 * Trims trailing whitespace from the script and the description,
 * and strips a single leading shebang line if the model wrapped
 * the script in fenced markdown despite the instructions.
 */
function parseResponse(raw: string, language: ScriptLanguage): { script: string; description: string } {
  let text = raw.trim();

  // Strip accidental markdown code fences (```bash / ```python / ```js / ```).
  const fenceMatch = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  }

  const delimiterIndex = text.indexOf(DESCRIPTION_DELIMITER);
  let scriptPart: string;
  let descriptionPart: string;

  if (delimiterIndex === -1) {
    scriptPart = text;
    descriptionPart = '';
  } else {
    scriptPart = text.slice(0, delimiterIndex).trim();
    descriptionPart = text
      .slice(delimiterIndex + DESCRIPTION_DELIMITER.length)
      .trim()
      // Take only the first non-empty line as the description.
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)[0] ?? '';
  }

  // Ensure the script starts with the correct shebang line. If the model
  // omitted it or used the wrong one, prepend the correct one.
  const expectedShebang = SHEBANG_BY_LANGUAGE[language];
  if (!scriptPart.startsWith(expectedShebang)) {
    // Remove any leading shebang the model may have emitted (e.g. wrong lang).
    scriptPart = scriptPart.replace(/^#!.*\n?/, '');
    scriptPart = `${expectedShebang}\n${scriptPart}`.trimEnd();
  }

  if (!descriptionPart) {
    descriptionPart = `Generated ${language} script.`;
  }

  return { script: scriptPart, description: descriptionPart };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json() as {
      message: string;
      projectId?: string;
      language?: string;
    };

    if (!body.message?.trim()) {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    // Normalize + validate language. Default to bash.
    const language: ScriptLanguage = (() => {
      const requested = body.language?.trim().toLowerCase();
      if (requested && VALID_LANGUAGES.has(requested as ScriptLanguage)) {
        return requested as ScriptLanguage;
      }
      return 'bash';
    })();

    // Optional project context.
    let project: ProjectContext | null = null;
    if (body.projectId?.trim()) {
      project = await fetchProjectContext(body.projectId.trim());
      if (!project) {
        return Response.json({ error: 'Project not found' }, { status: 404 });
      }
    }

    const zai = await ZAI.create();
    const systemPrompt = buildSystemPrompt(language, project);

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: body.message },
      ],
      thinking: { type: 'disabled' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    if (!raw.trim()) {
      return Response.json(
        { error: 'The model returned an empty response. Please try again.' },
        { status: 502 },
      );
    }

    const { script, description } = parseResponse(raw, language);

    return Response.json({
      script,
      language,
      filename: FILENAME_BY_LANGUAGE[language],
      description,
    });
  } catch (e) {
    return Response.json(
      {
        error: `Failed to generate script: ${e instanceof Error ? e.message : 'unknown error'}`,
      },
      { status: 500 },
    );
  }
}
