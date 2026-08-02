// ============================================================
// Forge — script helpers (typed encoding for script-as-pipeline)
// ============================================================
// Scripts are stored as Pipelines whose name is prefixed with `script:`
// and whose `config.customWorkflow` carries a single `run` step holding
// the user-authored code. The workflow's `env.SCRIPT_LANG` field records
// the script language so the runner and UI can dispatch on it later.
//
// This module provides typed helpers so the script↔pipeline encoding is
// in ONE place. The two script API routes (`scripts/route.ts` and
// `scripts/[id]/run/route.ts`) call these helpers instead of inlining
// the prefix/decode logic. This is the pragmatic fix for the
// "scripts-as-pipelines" hack documented in R-4 — the underlying
// storage scheme stays the same, but every caller goes through here so
// the encoding can be changed in one spot if we ever add a dedicated
// `Script` Prisma model.
// ============================================================

import type { CustomWorkflow } from './types';

/** Prefix that distinguishes a script Pipeline from a regular Pipeline. */
export const SCRIPT_PREFIX = 'script:';

/** Languages a script can be authored in. (Subset of CustomWorkflowStepLanguage.) */
export type ScriptLanguage = 'bash' | 'python' | 'node';

/** Serialized script summary returned by the scripts API. */
export interface ScriptSummary {
  id: string;
  name: string;
  description: string;
  language: ScriptLanguage;
  code: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

/** Minimal shape of a Pipeline row that `decodeScript` consumes. */
export interface ScriptPipelineRow {
  id: string;
  name: string;
  config: string;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal shape needed for the `isScriptPipeline` / `scriptName` predicates. */
export interface NamedPipelineLike {
  name: string;
}

/**
 * Returns `true` if the pipeline's name carries the `script:` prefix —
 * i.e. it was created by the scripts API rather than the regular
 * pipelines API.
 */
export function isScriptPipeline(pipeline: NamedPipelineLike): boolean {
  return pipeline.name.startsWith(SCRIPT_PREFIX);
}

/**
 * Strip the `script:` prefix from a pipeline's name to recover the
 * user-authored script name. If the prefix is absent, the name is
 * returned unchanged (defensive — shouldn't happen for real script
 * pipelines, but avoids throwing on corrupt rows).
 */
export function scriptName(pipeline: NamedPipelineLike): string {
  return pipeline.name.startsWith(SCRIPT_PREFIX)
    ? pipeline.name.slice(SCRIPT_PREFIX.length)
    : pipeline.name;
}

/**
 * Build a full pipeline name from a user-authored script name by
 * prepending the `script:` prefix. Idempotent — passing an
 * already-prefixed name returns it unchanged.
 */
export function fullScriptName(name: string): string {
  return name.startsWith(SCRIPT_PREFIX) ? name : `${SCRIPT_PREFIX}${name}`;
}

/** Runtime guard for the `ScriptLanguage` union. */
export function isScriptLanguage(value: unknown): value is ScriptLanguage {
  return value === 'bash' || value === 'python' || value === 'node';
}

/**
 * Decode a Pipeline row into a `ScriptSummary`, or return `null` if the
 * pipeline is not a valid script (e.g. missing `customWorkflow`,
 * malformed JSON, or empty steps array).
 */
export function decodeScript(pipeline: ScriptPipelineRow): ScriptSummary | null {
  let config: { customWorkflow?: CustomWorkflow };
  try {
    config = JSON.parse(pipeline.config);
  } catch {
    return null;
  }
  const workflow = config.customWorkflow;
  if (!workflow) return null;
  const step = workflow.steps[0];
  if (!step) return null;
  const rawLang = workflow.env?.SCRIPT_LANG;
  const language: ScriptLanguage = isScriptLanguage(rawLang) ? rawLang : 'bash';
  return {
    id: pipeline.id,
    name: scriptName(pipeline),
    description: workflow.description ?? '',
    language,
    code: step.run,
    projectId: pipeline.projectId,
    createdAt: pipeline.createdAt.toISOString(),
    updatedAt: pipeline.updatedAt.toISOString(),
  };
}

/**
 * Build the `CustomWorkflow` payload that gets embedded in a script
 * Pipeline's `config.customWorkflow`. Also returns the full pipeline
 * name (with the `script:` prefix) so callers don't have to call
 * `fullScriptName` separately.
 *
 * The script language is recorded in `workflow.env.SCRIPT_LANG` so the
 * runner and UI can dispatch on it later — `decodeScript` reads it back.
 */
export function encodeScript(
  name: string,
  description: string,
  language: ScriptLanguage,
  code: string,
): { fullName: string; workflow: CustomWorkflow } {
  const fullName = fullScriptName(name);
  return {
    fullName,
    workflow: {
      name: fullName,
      description,
      steps: [{ name: 'run', run: code }],
      env: { SCRIPT_LANG: language },
    },
  };
}
