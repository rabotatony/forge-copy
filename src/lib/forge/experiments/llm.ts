// ============================================================
// Forge — Experiments Lab LLM helpers
// ============================================================
// Two responsibilities:
//   1. extractJson<T>() — parse a free-form LLM response into a typed
//      object, tolerant of markdown fences, shebang lines, single quotes
//      and trailing commas. Returns null on parse failure (no throw).
//      Used by the experiment bodies (definitions.ts) to interpret LLM
//      output that should be JSON but isn't guaranteed to be.
//   2. generateScript() — call the ZAI LLM to generate a self-contained
//      bash/python/node script for an experiment. Retries on 429 with
//      exponential backoff (15s → 30s → 60s, three retries). The runner
//      wraps this in a hard AI_TIMEOUT_MS race so a stuck LLM call can
//      never block the experiment forever.
// ============================================================

import ZAI from 'z-ai-web-dev-sdk';
import type { GeneratedScript } from './types';

const FILENAME_BY_LANG: Record<string, string> = {
  bash: 'script.sh',
  python: 'script.py',
  node: 'script.js',
};
const SHEBANG_BY_LANG: Record<string, string> = {
  bash: '#!/bin/bash',
  python: '#!/usr/bin/env python3',
  node: '#!/usr/bin/env node',
};

// ---------------------------------------------------------------------------
// JSON extraction helper — strips markdown fences, finds the first JSON
// object/array, matches nesting respecting string literals, strips trailing
// commas. Returns null on parse failure.
// ---------------------------------------------------------------------------
export function extractJson<T = unknown>(text: string): T | null {
  if (typeof text !== `string`) return null;
  // 1. Strip markdown fences anywhere.
  let s = text.replace(/```[a-z]*\n?/gi, ``).replace(/```/gi, ``).trim();
  // 2. Strip shebang lines (bash scripts wrapping JSON).
  s = s.replace(/^#!.*$/gm, ``).trim();
  // 3. Find the first opening brace or bracket.
  const firstObj = s.indexOf(`{`);
  const firstArr = s.indexOf(`[`);
  let start = -1;
  let open = ``;
  let close = ``;
  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj; open = `{`; close = `}`;
  } else if (firstArr !== -1) {
    start = firstArr; open = `[`; close = `]`;
  } else {
    return null;
  }
  // 4. Match nesting, respecting string literals + escapes.
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === `\\`) { i++; continue; }
      if (ch === `"`) inStr = false;
      continue;
    }
    if (ch === `"`) { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  let jsonStr = s.slice(start, end + 1);
  // 5. Convert single quotes to double quotes (common AI mistake).
  jsonStr = jsonStr.replace(/'/g, `"`);
  // 6. Strip trailing commas before } or ].
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, `$1`);
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sandboxed LLM helpers (provided to every experiment via RunContext)
// ---------------------------------------------------------------------------

/** Call the LLM to generate a script. Hard timeout via Promise.race.
 *  Retries up to 2 times on rate-limit (429) errors with a 10s backoff. */
export async function generateScript(
  prompt: string,
  language: 'bash' | 'python' | 'node',
): Promise<GeneratedScript> {
  const zai = await ZAI.create();
  const shebang = SHEBANG_BY_LANG[language];

  const systemPrompt = `You are a scripting expert inside the Forge Experiments Lab.
Generate a single executable ${language} script that accomplishes the user's request.
Output ONLY the script code — no markdown fences, no explanation.
The script MUST start with the shebang line \`${shebang}\`.
The script must be self-contained, deterministic, and finish quickly (under 5 seconds).
Do NOT access the network. Do NOT delete files outside the current directory.
After the script, on a new line by itself, output exactly \`---DESCRIPTION---\`,
then on the next line a single one-line description (max 120 chars).`;

  let completion;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        thinking: { type: 'disabled' },
      });
      break;
    } catch (err: unknown) {
      const errMsg = String(err);
      if (errMsg.includes('429') && attempt < 3) {
        // Rate limited — exponential backoff: 15s, 30s, 60s.
        const waitMs = 15_000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  if (!completion) throw new Error('LLM completion failed after retries');

  const raw = completion.choices[0]?.message?.content ?? '';

  let code = raw;
  let description = `${language} script`;
  const delim = raw.indexOf('---DESCRIPTION---');
  if (delim !== -1) {
    code = raw.slice(0, delim).trim();
    const after = raw.slice(delim + '---DESCRIPTION---'.length).trim();
    description = after.split('\n')[0]?.trim() || description;
  }

  // Strip markdown fences if the model added them anyway.
  code = code.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

  return {
    language,
    filename: FILENAME_BY_LANG[language],
    code,
    description,
  };
}
