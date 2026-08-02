// ============================================================
// Forge — multi-stage DAG pipeline engine (Phase 2)
// ============================================================
// A Pipeline is a directed-acyclic-graph of stages. Each stage runs a
// single Workflow (with optional matrix fan-out, retry, timeout,
// approval gate, secrets, cache, env vars, and an `if` skip condition).
//
// Stages with no unmet `needs` run in parallel. The pipeline runs in
// the background — `executePipeline` returns the pipelineRunId
// immediately and the rest happens via async polling.
//
// Custom workflows: when `pipeline.config.customWorkflow` is set, the
// pipeline is a single-stage wrapper around a user-authored
// CustomWorkflow (stored by `saveCustomWorkflow`). The executor detects
// this and calls `runCustomWorkflow` instead of `startRunExtended`.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';
import {
  startRunExtended,
  cancelRun,
  expandMatrix,
  approveRun,
  rejectRun,
  subscribe,
  emit,
  appendLog,
  finishRun,
} from './engine';
import { substituteMatrix } from './matrix';
import { buildProcessEnv, getSecrets } from './secrets';
import { hasCache, restoreCache, saveCache } from './cache';
import {
  runChildStep,
  formatBytes,
  isBlockedCommand,
  type StepLanguage,
} from './child-runner';
import { storeTestReport } from './test-report';
import type { RunStatus } from './engine';
import type {
  CustomWorkflow,
  CustomWorkflowStep,
  CustomWorkflowStepLanguage,
  MatrixRow,
  PipelineDefinition,
  PipelineStage,
} from './types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a PipelineDefinition:
 *   - stages must be non-empty
 *   - all stage IDs unique
 *   - all `needs` reference existing stages
 *   - no cycles
 */
export function validatePipelineDefinition(def: PipelineDefinition): ValidationResult {
  const errors: string[] = [];
  if (!def.stages || def.stages.length === 0) {
    errors.push('Pipeline must have at least one stage.');
    return { valid: false, errors };
  }
  const ids = new Set<string>();
  for (const stage of def.stages) {
    if (!stage.id) {
      errors.push(`Stage "${stage.name ?? '<unnamed>'}" is missing an id.`);
      continue;
    }
    if (ids.has(stage.id)) {
      errors.push(`Duplicate stage id: "${stage.id}".`);
    }
    ids.add(stage.id);
  }
  // Check `needs` references.
  for (const stage of def.stages) {
    if (!stage.needs) continue;
    for (const need of stage.needs) {
      if (!ids.has(need)) {
        errors.push(`Stage "${stage.id}" needs unknown stage "${need}".`);
      }
      if (need === stage.id) {
        errors.push(`Stage "${stage.id}" cannot need itself.`);
      }
    }
  }
  // Cycle detection (DFS).
  const cycle = detectCycle(def.stages);
  if (cycle) {
    errors.push(`Pipeline has a cycle: ${cycle.join(' → ')}.`);
  }
  return { valid: errors.length === 0, errors };
}

function detectCycle(stages: PipelineStage[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const s of stages) adj.set(s.id, s.needs ?? []);
  const visited = new Set<string>();
  const path = new Set<string>();
  const pathList: string[] = [];

  function dfs(node: string): string[] | null {
    if (path.has(node)) {
      // Found a cycle — return the cycle path from the first occurrence.
      const start = pathList.indexOf(node);
      return [...pathList.slice(start), node];
    }
    if (visited.has(node)) return null;
    visited.add(node);
    path.add(node);
    pathList.push(node);
    for (const dep of adj.get(node) ?? []) {
      const result = dfs(dep);
      if (result) return result;
    }
    path.delete(node);
    pathList.pop();
    return null;
  }

  for (const s of stages) {
    const result = dfs(s.id);
    if (result) return result;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Topological ordering (Kahn's algorithm — level by level)
// ---------------------------------------------------------------------------

/**
 * Group stages into "levels" — sets of stages that can run in parallel
 * because all their `needs` are in earlier levels.
 */
function topologicalLevels(stages: PipelineStage[]): PipelineStage[][] {
  const byId = new Map(stages.map(s => [s.id, s]));
  const remaining = new Set(stages.map(s => s.id));
  const levels: PipelineStage[][] = [];
  while (remaining.size > 0) {
    const ready: PipelineStage[] = [];
    for (const id of remaining) {
      const stage = byId.get(id)!;
      const needs = stage.needs ?? [];
      if (needs.every(n => !remaining.has(n))) {
        ready.push(stage);
      }
    }
    if (ready.length === 0) {
      // Shouldn't happen — cycle detection should have caught this.
      break;
    }
    for (const s of ready) remaining.delete(s.id);
    levels.push(ready);
  }
  return levels;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

interface ConditionContext {
  matrix: MatrixRow;
  // Status of all needed stages: { stageId: 'success' | 'failed' | 'skipped' | 'canceled' }
  neededResults: Record<string, string>;
}

/**
 * Evaluate a stage `if` condition.
 *
 * Supported syntax:
 *   • `always()`                    — always true
 *   • `success()`                   — true if all needed stages succeeded
 *   • `failure()`                   — true if any needed stage failed/canceled
 *   • `matrix.KEY == 'value'`       — string equality
 *   • `matrix.KEY != 'value'`       — string inequality
 *   • `matrix.KEY == "value"`       — string equality (double quotes)
 *   • `matrix.KEY != "value"`       — string inequality (double quotes)
 *   • Combinations via `&&`, `||`, `!`, and parentheses.
 *
 * Returns false on any parse error (conservative — skip the stage).
 */
export function evaluateCondition(expr: string, ctx: ConditionContext): boolean {
  if (!expr || expr.trim() === '') return true;
  const allSuccess = Object.values(ctx.neededResults).every(s => s === 'success');
  const anyFailed = Object.values(ctx.neededResults).some(s => s === 'failed' || s === 'canceled');

  let s = expr.trim();
  // Function-call replacements.
  s = s.replace(/\balways\s*\(\s*\)/g, 'true');
  s = s.replace(/\bsuccess\s*\(\s*\)/g, allSuccess ? 'true' : 'false');
  s = s.replace(/\bfailure\s*\(\s*\)/g, anyFailed ? 'true' : 'false');
  // matrix.KEY == 'value' / != 'value' (single or double quotes).
  s = s.replace(
    /\bmatrix\.(\w+)\s*(==|!=)\s*'([^']*)'/g,
    (_, key, op, val) => (op === '==' ? ((ctx.matrix[key] ?? '') === val) : ((ctx.matrix[key] ?? '') !== val)) ? 'true' : 'false',
  );
  s = s.replace(
    /\bmatrix\.(\w+)\s*(==|!=)\s*"([^"]*)"/g,
    (_, key, op, val) => (op === '==' ? ((ctx.matrix[key] ?? '') === val) : ((ctx.matrix[key] ?? '') !== val)) ? 'true' : 'false',
  );
  // Any remaining matrix.KEY reference → replace with its value (quoted) so
  // bare references work too (treated as truthy non-empty string).
  s = s.replace(/\bmatrix\.(\w+)/g, (_, key) => (ctx.matrix[key] ?? '') ? 'true' : 'false');

  return evalBoolean(s);
}

/**
 * Evaluate a reduced boolean expression containing only `true`, `false`,
 * `&&`, `||`, `!`, `(`, `)`, and whitespace. Hand-written recursive descent
 * parser — no `eval` / `Function` constructor, so no code injection risk.
 */
function evalBoolean(s: string): boolean {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(' || c === ')') { tokens.push(c); i++; continue; }
    if (c === '!') { tokens.push('!'); i++; continue; }
    if (c === '&' && s[i + 1] === '&') { tokens.push('&&'); i += 2; continue; }
    if (c === '|' && s[i + 1] === '|') { tokens.push('||'); i += 2; continue; }
    if (s.slice(i, i + 4) === 'true') { tokens.push('true'); i += 4; continue; }
    if (s.slice(i, i + 5) === 'false') { tokens.push('false'); i += 5; continue; }
    // Unknown token — bail.
    return false;
  }
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const consume = (): string | undefined => tokens[pos++];
  function parseOr(): boolean {
    let v = parseAnd();
    while (peek() === '||') { consume(); v = parseAnd() || v; }
    return v;
  }
  function parseAnd(): boolean {
    let v = parseNot();
    while (peek() === '&&') { consume(); v = parseNot() && v; }
    return v;
  }
  function parseNot(): boolean {
    if (peek() === '!') { consume(); return !parseNot(); }
    return parsePrimary();
  }
  function parsePrimary(): boolean {
    const t = consume();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === '(') {
      const v = parseOr();
      if (peek() === ')') consume();
      return v;
    }
    return false;
  }
  return parseOr();
}

// ---------------------------------------------------------------------------
// Matrix substitution — uses the shared `substituteMatrix` from
// `./matrix` so behaviour is identical to engine.ts and
// custom-workflow.ts. (Previously each module had its own copy.)
// ---------------------------------------------------------------------------

function substituteMatrixInRecord(rec: Record<string, string> | undefined, matrix: MatrixRow): Record<string, string> {
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = substituteMatrix(v, matrix);
  return out;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createPipeline(
  projectId: string,
  name: string,
  definition: PipelineDefinition,
): Promise<{ id: string }> {
  const validation = validatePipelineDefinition(definition);
  if (!validation.valid) {
    throw new Error(`Invalid pipeline: ${validation.errors.join(' ')}`);
  }
  const pipeline = await db.pipeline.create({
    data: {
      projectId,
      name,
      stages: JSON.stringify(definition.stages),
      config: JSON.stringify(definition.config ?? {}),
    },
  });
  return { id: pipeline.id };
}

export async function listPipelines(projectId: string): Promise<Array<{
  id: string;
  name: string;
  stages: string;
  config: string;
  createdAt: Date;
  updatedAt: Date;
}>> {
  return db.pipeline.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPipeline(pipelineId: string): Promise<{
  id: string;
  projectId: string;
  name: string;
  stages: string;
  config: string;
  createdAt: Date;
  updatedAt: Date;
  runs: Array<{
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    trigger: string;
  }>;
} | null> {
  const pipeline = await db.pipeline.findUnique({
    where: { id: pipelineId },
    include: {
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 25,
      },
    },
  });
  if (!pipeline) return null;
  return pipeline;
}

export async function deletePipeline(projectId: string, pipelineId: string): Promise<void> {
  // Verify ownership before deleting.
  const pipeline = await db.pipeline.findFirst({
    where: { id: pipelineId, projectId },
  });
  if (!pipeline) throw new Error('Pipeline not found');
  await db.pipeline.delete({ where: { id: pipelineId } });
}

export async function listPipelineRuns(projectId: string, limit = 50): Promise<Array<{
  id: string;
  pipelineId: string;
  projectId: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  trigger: string;
}>> {
  return db.pipelineRun.findMany({
    where: { projectId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}

// ============================================================
// Custom workflows (moved from `./custom-workflow` in R-4)
// ============================================================
// A CustomWorkflow is a JSON document authored by the project owner
// describing a list of shell steps (with per-step env, retry, timeout,
// cache, working dir, test-report capture, and continueOnError). It is
// the lightweight alternative to defining a multi-stage Pipeline — in
// fact, a custom workflow IS a single-stage pipeline. Storage: a custom
// workflow is stored as a Pipeline with a single 'custom' stage and the
// full CustomWorkflow JSON in the pipeline's `config.customWorkflow`
// field. The pipeline executor detects this and calls `runCustomWorkflow`
// directly (it's now in the same file) instead of `startRunExtended`.
//
// Custom workflows share the engine's SSE event bus (via `subscribe`,
// `emit`, `appendLog`, `finishRun`) so the existing
// `/api/forge/runs/[id]/events` SSE route picks them up automatically.
// ------------------------------------------------------------

// Allowed interpreter languages for custom workflow steps.
const STEP_LANGUAGES: readonly CustomWorkflowStepLanguage[] = ['bash', 'node', 'python', 'ruby'] as const;

/**
 * Coerce an unknown value into a valid CustomWorkflowStepLanguage, or throw.
 * Returns 'bash' when the value is absent (undefined/null). Throws a clear
 * error when the value is present but not one of the allowed languages.
 */
function coerceStepLanguage(raw: unknown, stepIndex: number): CustomWorkflowStepLanguage {
  if (raw === undefined || raw === null) return 'bash';
  if (typeof raw !== 'string') {
    throw new Error(`Step ${stepIndex} has invalid "language" (expected string, got ${typeof raw}).`);
  }
  if (!(STEP_LANGUAGES as readonly string[]).includes(raw)) {
    throw new Error(`Step ${stepIndex} has invalid "language" "${raw}". Allowed: ${STEP_LANGUAGES.join(', ')}.`);
  }
  return raw as CustomWorkflowStepLanguage;
}

// ---------------------------------------------------------------------------
// Parsing + validation
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a CustomWorkflow. Throws on invalid input.
 */
export function parseCustomWorkflow(json: string): CustomWorkflow {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`Custom workflow is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Custom workflow must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    throw new Error('Custom workflow must have a non-empty "name" string.');
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error('Custom workflow must have a non-empty "steps" array.');
  }
  const steps: CustomWorkflowStep[] = [];
  for (let i = 0; i < obj.steps.length; i++) {
    const s = obj.steps[i] as Record<string, unknown>;
    if (typeof s !== 'object' || s === null) {
      throw new Error(`Step ${i} must be an object.`);
    }
    if (typeof s.name !== 'string' || s.name.trim() === '') {
      throw new Error(`Step ${i} must have a non-empty "name".`);
    }
    if (typeof s.run !== 'string' || s.run.trim() === '') {
      throw new Error(`Step ${i} must have a non-empty "run" command.`);
    }
    const step: CustomWorkflowStep = { name: s.name, run: s.run };
    // Per-step interpreter language (defaults to 'bash' when absent).
    const language = coerceStepLanguage(s.language, i);
    if (language !== 'bash') step.language = language;
    if (typeof s.workingDir === 'string') step.workingDir = s.workingDir;
    if (s.env && typeof s.env === 'object') {
      step.env = Object.fromEntries(
        Object.entries(s.env as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>;
    }
    if (typeof s.retry === 'number') step.retry = s.retry;
    if (typeof s.timeoutMs === 'number') step.timeoutMs = s.timeoutMs;
    if (s.cache && typeof s.cache === 'object') {
      const c = s.cache as Record<string, unknown>;
      if (typeof c.key === 'string' && Array.isArray(c.paths)) {
        step.cache = {
          key: c.key,
          paths: (c.paths as unknown[]).filter((p): p is string => typeof p === 'string'),
          restore: c.restore !== false,
          save: c.save !== false,
        };
      }
    }
    if (s.testReport && typeof s.testReport === 'object') {
      const tr = s.testReport as Record<string, unknown>;
      if (typeof tr.format === 'string' && typeof tr.path === 'string') {
        step.testReport = {
          format: tr.format as 'junit' | 'json' | 'tap',
          path: tr.path,
        };
      }
    }
    if (typeof s.continueOnError === 'boolean') step.continueOnError = s.continueOnError;
    steps.push(step);
  }
  const workflow: CustomWorkflow = { name: obj.name, steps };
  if (typeof obj.description === 'string') workflow.description = obj.description;
  if (obj.matrix && typeof obj.matrix === 'object') {
    const m = obj.matrix as Record<string, unknown>;
    if (Array.isArray(m.dimensions)) {
      workflow.matrix = {
        dimensions: (m.dimensions as unknown[])
          .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
          .map(d => ({
            key: String(d.key ?? ''),
            values: Array.isArray(d.values)
              ? (d.values as unknown[]).filter((v): v is string => typeof v === 'string')
              : [],
          }))
          .filter(d => d.key !== ''),
        exclude: Array.isArray(m.exclude) ? (m.exclude as MatrixRow[]) : undefined,
        include: Array.isArray(m.include) ? (m.include as MatrixRow[]) : undefined,
      };
    }
  }
  if (typeof obj.retry === 'number') workflow.retry = obj.retry;
  if (typeof obj.timeoutMs === 'number') workflow.timeoutMs = obj.timeoutMs;
  if (typeof obj.requiresApproval === 'boolean') workflow.requiresApproval = obj.requiresApproval;
  if (Array.isArray(obj.secrets)) {
    workflow.secrets = (obj.secrets as unknown[]).filter((s): s is string => typeof s === 'string');
  }
  if (obj.env && typeof obj.env === 'object') {
    workflow.env = Object.fromEntries(
      Object.entries(obj.env as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  }
  return workflow;
}

/**
 * Validate a CustomWorkflow object. Returns `{ valid, errors }`.
 */
export function validateCustomWorkflow(workflow: CustomWorkflow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!workflow.name || workflow.name.trim() === '') {
    errors.push('Custom workflow must have a non-empty "name".');
  }
  if (!workflow.steps || workflow.steps.length === 0) {
    errors.push('Custom workflow must have at least one step.');
  } else {
    const names = new Set<string>();
    for (let i = 0; i < workflow.steps.length; i++) {
      const s = workflow.steps[i]!;
      if (!s.name || s.name.trim() === '') {
        errors.push(`Step ${i} must have a non-empty "name".`);
        continue;
      }
      if (names.has(s.name)) {
        errors.push(`Duplicate step name: "${s.name}".`);
      }
      names.add(s.name);
      if (!s.run || s.run.trim() === '') {
        errors.push(`Step "${s.name}" must have a non-empty "run" command.`);
      }
      if (s.language !== undefined && !(STEP_LANGUAGES as readonly string[]).includes(s.language)) {
        errors.push(`Step "${s.name}" has invalid "language" "${s.language}". Allowed: ${STEP_LANGUAGES.join(', ')}.`);
      }
    }
  }
  if (workflow.matrix?.dimensions) {
    for (const dim of workflow.matrix.dimensions) {
      if (!dim.key || dim.key.trim() === '') {
        errors.push('Matrix dimension must have a non-empty "key".');
      }
      if (!dim.values || dim.values.length === 0) {
        errors.push(`Matrix dimension "${dim.key}" must have at least one value.`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Save a custom workflow as a Pipeline with a single 'custom' stage.
 * The full CustomWorkflow JSON is stored in the pipeline's config field
 * under `customWorkflow`, and the pipeline executor dispatches to
 * `runCustomWorkflow` instead of `startRunExtended`.
 */
export async function saveCustomWorkflow(
  projectId: string,
  name: string,
  workflow: CustomWorkflow,
): Promise<{ id: string }> {
  const validation = validateCustomWorkflow(workflow);
  if (!validation.valid) {
    throw new Error(`Invalid custom workflow: ${validation.errors.join(' ')}`);
  }
  // Build a minimal PipelineDefinition with a single 'custom' stage.
  const stages = [
    {
      id: 'custom',
      name: workflow.name,
      workflow: 'custom',
      needs: [] as string[],
      ...(workflow.matrix ? { matrix: workflow.matrix } : {}),
      ...(workflow.retry !== undefined ? { retry: workflow.retry } : {}),
      ...(workflow.timeoutMs !== undefined ? { timeoutMs: workflow.timeoutMs } : {}),
      ...(workflow.requiresApproval ? { requiresApproval: true } : {}),
      ...(workflow.secrets ? { secrets: workflow.secrets } : {}),
      ...(workflow.env ? { env: workflow.env } : {}),
    },
  ];
  const config = { customWorkflow: workflow };
  const pipeline = await db.pipeline.create({
    data: {
      projectId,
      name,
      stages: JSON.stringify(stages),
      config: JSON.stringify(config),
    },
  });
  return { id: pipeline.id };
}

// ---------------------------------------------------------------------------
// Custom-workflow execution
// ---------------------------------------------------------------------------

export interface RunCustomWorkflowOptions {
  trigger?: 'manual' | 'auto' | 'webhook' | 'cron' | 'pipeline';
  matrixValues?: MatrixRow;
  pipelineRunId?: string;
  stageId?: string;
  label?: string;
}

/**
 * Run a CustomWorkflow. Creates a Run row with `workflow: 'custom'` and
 * executes the steps directly (without going through `startRunExtended`,
 * which only knows about predefined workflows). Shares the engine's SSE
 * event bus so the existing `/api/forge/runs/[id]/events` route picks
 * it up.
 *
 * Returns immediately with `{ runId }`; execution continues in the
 * background.
 */
export async function runCustomWorkflow(
  projectId: string,
  workflow: CustomWorkflow,
  options: RunCustomWorkflowOptions = {},
): Promise<{ runId: string }> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const run = await db.run.create({
    data: {
      projectId,
      workflow: 'custom',
      status: 'running',
      trigger: options.trigger ?? 'manual',
      startedAt: new Date(),
      matrixValues: options.matrixValues ? JSON.stringify(options.matrixValues) : null,
      pipelineRunId: options.pipelineRunId,
      stageId: options.stageId,
      label: options.label ?? workflow.name,
    },
  });

  emit({ type: 'status', runId: run.id, status: 'running' });

  // Fire-and-forget execution.
  void executeCustomSteps(run.id, project.extractedPath, workflow, projectId, options);

  return { runId: run.id };
}

async function executeCustomSteps(
  runId: string,
  projectRoot: string,
  workflow: CustomWorkflow,
  projectId: string,
  options: RunCustomWorkflowOptions,
): Promise<void> {
  const startedAt = Date.now();
  try {
    // Resolve secrets (workflow-level).
    const secretKeys = new Set<string>(workflow.secrets ?? []);
    const allSecrets = secretKeys.size > 0
      ? await getSecrets(projectId, Array.from(secretKeys))
      : {};

    // Merge workflow-level env + matrix-derived env.
    const workflowEnv: Record<string, string> = { ...(workflow.env ?? {}) };
    if (options.matrixValues) {
      for (const [k, v] of Object.entries(options.matrixValues)) {
        workflowEnv[`MATRIX_${k.toUpperCase()}`] = v;
      }
    }

    // Run each step.
    let lastExitCode = 0;
    for (const step of workflow.steps) {
      // Matrix substitution in step command + env.
      const matrix = options.matrixValues ?? {};
      const stepCommand = substituteMatrix(step.run, matrix);
      const stepEnv: Record<string, string> = {
        ...workflowEnv,
        ...substituteMatrixInRecord(step.env ?? {}, matrix),
      };

      // Cache restore (per-step).
      if (step.cache?.restore) {
        const hit = await hasCache(projectId, step.cache.key);
        if (hit) {
          const restored = await restoreCache(projectId, step.cache.key);
          if (restored.hit) {
            await appendLog(runId, 'system', `💾 Cache hit: ${step.cache.key} (${formatBytes(restored.size ?? 0)})`);
          }
        } else {
          await appendLog(runId, 'system', `💾 Cache miss: ${step.cache.key}`);
        }
      }

      // Run with per-step retry.
      const maxAttempts = (step.retry ?? 0) + 1;
      let attempt = 0;
      let stepExit = 1;
      while (attempt < maxAttempts) {
        if (attempt > 0) {
          emit({ type: 'retry', runId, retryAttempt: attempt });
          await appendLog(runId, 'system', `↻ Retry ${attempt}/${maxAttempts - 1} for: ${step.name}`);
        }
        await appendLog(runId, 'system', `▶ ${step.name}`);
        // Pass the step with `run` already matrix-substituted so the
        // executeStepCommand helper can write the script body to a temp
        // file when language is node/python/ruby.
        stepExit = await executeStepCommand(
          runId,
          { ...step, run: stepCommand },
          step.workingDir ? path.join(projectRoot, step.workingDir) : projectRoot,
          { secrets: allSecrets, extraEnv: stepEnv, timeoutMs: step.timeoutMs, projectId },
        );
        if (stepExit === 0) break;
        attempt++;
      }

      // Cache save (per-step) — even on failure (partial cache is useful).
      if (step.cache?.save) {
        try {
          const { size } = await saveCache(projectId, step.cache.key, step.cache.key, step.cache.paths);
          await appendLog(runId, 'system', `💾 Cache saved: ${step.cache.key} (${formatBytes(size)})`);
        } catch (err) {
          await appendLog(runId, 'system', `Cache save failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Test report capture (per-step).
      if (step.testReport) {
        try {
          const reportPath = path.join(projectRoot, step.testReport.path);
          if (fs.existsSync(reportPath)) {
            const content = fs.readFileSync(reportPath, 'utf-8');
            const { parseJUnit, parseJSONReport, parseTAP } = await import('./test-report');
            const report =
              step.testReport.format === 'junit' ? parseJUnit(content)
              : step.testReport.format === 'json' ? parseJSONReport(content)
              : parseTAP(content);
            await storeTestReport(runId, report);
            await appendLog(runId, 'system', `📊 Test report: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.total} total).`);
          }
        } catch (err) {
          await appendLog(runId, 'system', `Test report parsing failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (stepExit !== 0) {
        lastExitCode = stepExit;
        if (step.continueOnError) {
          await appendLog(runId, 'system', `⚠ Step "${step.name}" failed with exit code ${stepExit} (continueOnError=true).`);
          continue;
        }
        await appendLog(runId, 'system', `✗ Step "${step.name}" failed with exit code ${stepExit} after ${attempt} attempt(s).`);
        await finishRun(runId, 'failed', stepExit, Date.now() - startedAt);
        return;
      }
      await appendLog(runId, 'system', `✓ ${step.name}`);
    }

    // Workflow-level test report capture (after all steps complete).
    if (workflow.testReport) {
      try {
        const reportPath = path.join(projectRoot, workflow.testReport.path);
        if (fs.existsSync(reportPath)) {
          const content = fs.readFileSync(reportPath, 'utf-8');
          const { parseJUnit, parseJSONReport, parseTAP } = await import('./test-report');
          const report =
            workflow.testReport.format === 'junit' ? parseJUnit(content)
            : workflow.testReport.format === 'json' ? parseJSONReport(content)
            : parseTAP(content);
          await storeTestReport(runId, report);
          await appendLog(runId, 'system', `📊 Test report: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.total} total).`);
        }
      } catch (err) {
        await appendLog(runId, 'system', `Test report parsing failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await finishRun(runId, 'success', lastExitCode, Date.now() - startedAt);
  } catch (err) {
    await appendLog(runId, 'system', `Custom workflow crashed: ${err instanceof Error ? err.message : String(err)}`);
    await finishRun(runId, 'failed', -1, Date.now() - startedAt);
  }
}

// ---------------------------------------------------------------------------
// Step execution — delegates to the shared runChildStep primitive.
// ---------------------------------------------------------------------------

interface StepEnvOptions {
  projectId: string;
  secrets: Record<string, string>;
  extraEnv: Record<string, string>;
  timeoutMs?: number;
}

const LANGUAGE_MAP: Record<CustomWorkflowStepLanguage, StepLanguage> = {
  bash: 'bash',
  node: 'node',
  python: 'python',
  ruby: 'ruby',
};

/**
 * Execute a single custom-workflow step. Delegates the actual spawning,
 * timeout, secret-masking, and SIGTERM/SIGKILL dance to the shared
 * `runChildStep` primitive so behaviour is identical to the engine's
 * `runShellStep`.
 */
async function executeStepCommand(
  runId: string,
  step: CustomWorkflowStep,
  cwd: string,
  envOptions: StepEnvOptions,
): Promise<number> {
  const rawLanguage = step.language ?? 'bash';
  if (!(STEP_LANGUAGES as readonly string[]).includes(rawLanguage)) {
    await appendLog(runId, 'system', `✗ Unknown step language "${String(step.language)}" for step "${step.name}". Allowed: ${STEP_LANGUAGES.join(', ')}.`);
    return 1;
  }
  const language = LANGUAGE_MAP[rawLanguage];
  const command = step.run;

  if (isBlockedCommand(command)) {
    await appendLog(runId, 'system', `🚫 Command blocked by security policy: ${command.slice(0, 80)}`);
    return 126;
  }

  await appendLog(runId, 'system', `▶ Running ${language} step: ${step.name}`);

  const baseEnv = await buildProcessEnv(envOptions.projectId, {
    extraEnv: envOptions.extraEnv,
    projectRoot: cwd,
  });
  const fullEnv = { ...baseEnv, ...envOptions.secrets };

  const result = await runChildStep({
    cwd,
    command,
    language,
    env: fullEnv,
    secrets: envOptions.secrets,
    timeoutMs: envOptions.timeoutMs ?? null,
    onLine: (stream, text) => { void appendLog(runId, stream, text); },
  });

  if (result.timedOut) {
    await appendLog(runId, 'system', `⏱ Step timed out after ${envOptions.timeoutMs}ms.`);
  }
  return result.exitCode;
}

// Re-export subscribe for the SSE API route to use uniformly. (Kept here
// so the `./custom-workflow` barrel can re-export it from one place.)
export { subscribe };

// ---------------------------------------------------------------------------
// Pipeline execution
// ---------------------------------------------------------------------------

/**
 * Start a new pipeline run. Returns immediately with the pipelineRunId —
 * the actual stage execution happens in the background. Also exported as
 * `startPipelineRun` for compatibility with `triggers.ts` (which calls
 * it via a lazy `import('./pipeline')`).
 */
export async function executePipeline(
  pipelineId: string,
  trigger: 'manual' | 'auto' | 'webhook' | 'cron' | 'pipeline' = 'manual',
): Promise<{ pipelineRunId: string }> {
  const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId } });
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  const stages: PipelineStage[] = JSON.parse(pipeline.stages);
  const config = JSON.parse(pipeline.config ?? '{}') as PipelineDefinition['config'];

  const pipelineRun = await db.pipelineRun.create({
    data: {
      pipelineId,
      projectId: pipeline.projectId,
      status: 'running',
      trigger,
      context: '{}',
    },
  });

  // Fire-and-forget the actual execution.
  void runPipelineInBackground(pipelineRun.id, pipeline.projectId, stages, config, trigger);

  return { pipelineRunId: pipelineRun.id };
}

/** Alias used by `triggers.ts`'s lazy importer. */
export const startPipelineRun = executePipeline;

async function runPipelineInBackground(
  pipelineRunId: string,
  projectId: string,
  stages: PipelineStage[],
  config: PipelineDefinition['config'],
  trigger: string,
): Promise<void> {
  try {
    // Check if this is a custom-workflow pipeline (single 'custom' stage with
    // the workflow JSON stored in config.customWorkflow).
    const customWorkflow = (config as { customWorkflow?: unknown }).customWorkflow;
    if (customWorkflow && stages.length === 1 && stages[0]?.workflow === 'custom') {
      const stage = stages[0];
      const stageRun = await db.stageRun.create({
        data: {
          pipelineRunId,
          stageId: stage.id,
          stageName: stage.name,
          status: 'running',
          startedAt: new Date(),
          runIds: '[]',
        },
      });
      try {
        const { runId } = await runCustomWorkflow(projectId, customWorkflow as Parameters<typeof runCustomWorkflow>[1], {
          trigger: trigger as 'manual' | 'auto' | 'webhook' | 'cron' | 'pipeline',
          pipelineRunId,
          stageId: stage.id,
          label: stage.name,
        });
        await db.stageRun.update({
          where: { id: stageRun.id },
          data: { runIds: JSON.stringify([runId]) },
        });
        const finalStatus = await waitForRunCompletion(runId);
        await db.stageRun.update({
          where: { id: stageRun.id },
          data: {
            status: finalStatus,
            finishedAt: new Date(),
          },
        });
        await finishPipelineRun(pipelineRunId, finalStatus === 'success' ? 'success' : 'failed');
        return;
      } catch (err) {
        await db.stageRun.update({
          where: { id: stageRun.id },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            error: err instanceof Error ? err.message : String(err),
          },
        });
        await finishPipelineRun(pipelineRunId, 'failed');
        return;
      }
    }

    // Standard DAG execution: topologically-grouped levels, run in parallel.
    const levels = topologicalLevels(stages);
    const stageResults: Record<string, string> = {}; // stageId → 'success' | 'failed' | 'skipped' | 'canceled'

    for (const level of levels) {
      // Run all stages in this level in parallel.
      await Promise.all(level.map(stage => runStage(stage, pipelineRunId, projectId, trigger, stageResults, config)));
      // If any stage in this level failed/canceled and the pipeline doesn't
      // allow continuation, we still proceed to the next level — individual
      // stages will skip themselves based on their `needs` results.
    }

    // Final status: success if no stage failed/canceled; failed otherwise.
    const anyFailed = Object.values(stageResults).some(s => s === 'failed' || s === 'canceled');
    await finishPipelineRun(pipelineRunId, anyFailed ? 'failed' : 'success');
  } catch (err) {
    await db.pipelineRun.update({
      where: { id: pipelineRunId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
      },
    });
    console.error('[forge:pipeline] background execution failed:', err);
  }
}

async function runStage(
  stage: PipelineStage,
  pipelineRunId: string,
  projectId: string,
  trigger: string,
  stageResults: Record<string, string>,
  config: PipelineDefinition['config'],
): Promise<void> {
  const neededResults: Record<string, string> = {};
  for (const need of stage.needs ?? []) {
    neededResults[need] = stageResults[need] ?? 'skipped';
  }

  // Create a StageRun row up-front (status: pending).
  const stageRun = await db.stageRun.create({
    data: {
      pipelineRunId,
      stageId: stage.id,
      stageName: stage.name,
      status: 'pending',
      runIds: '[]',
    },
  });

  // 1. `if` condition.
  try {
    if (stage.if && !evaluateCondition(stage.if, { matrix: {}, neededResults })) {
      await db.stageRun.update({
        where: { id: stageRun.id },
        data: { status: 'skipped', finishedAt: new Date() },
      });
      stageResults[stage.id] = 'skipped';
      return;
    }
  } catch {
    // Parse error → skip conservatively.
    await db.stageRun.update({
      where: { id: stageRun.id },
      data: { status: 'skipped', finishedAt: new Date() },
    });
    stageResults[stage.id] = 'skipped';
    return;
  }

  // 2. If any `needs` stage failed/canceled/skipped and this stage doesn't
  //    have `if: failure()` (or `if: always()`), skip.
  const needsFailed = Object.values(neededResults).some(s => s === 'failed' || s === 'canceled');
  const needsSkipped = Object.values(neededResults).some(s => s === 'skipped');
  const hasFailureCondition = stage.if?.includes('failure()') ?? false;
  const hasAlwaysCondition = stage.if?.includes('always()') ?? false;
  if ((needsFailed || needsSkipped) && !hasFailureCondition && !hasAlwaysCondition) {
    await db.stageRun.update({
      where: { id: stageRun.id },
      data: { status: 'skipped', finishedAt: new Date() },
    });
    stageResults[stage.id] = 'skipped';
    return;
  }

  await db.stageRun.update({
    where: { id: stageRun.id },
    data: { status: 'running', startedAt: new Date() },
  });

  // 3. Expand matrix (if any).
  let matrixRows: MatrixRow[] = [{}];
  if (stage.matrix?.dimensions && stage.matrix.dimensions.length > 0) {
    matrixRows = expandMatrix(
      stage.matrix.dimensions,
      stage.matrix.exclude ?? [],
      stage.matrix.include ?? [],
    );
  }

  const runIds: string[] = [];
  let stageFailed = false;
  let stageCanceled = false;

  // 4. Run each matrix row. Use limited concurrency (Promise.all is fine
  //    for typical matrix sizes — they're usually ≤ 10 rows).
  const results = await Promise.all(matrixRows.map(async (matrixValues, idx) => {
    // Per-row env / cache.key / if substitution.
    const rowEnv = substituteMatrixInRecord(stage.env, matrixValues);
    const rowCacheKey = stage.cache ? substituteMatrix(stage.cache.key, matrixValues) : undefined;

    // Re-evaluate `if` with this matrix row (per-row skip).
    if (stage.if) {
      try {
        if (!evaluateCondition(stage.if, { matrix: matrixValues, neededResults })) {
          return { matrixValues, status: 'skipped' as const, runId: null };
        }
      } catch {
        return { matrixValues, status: 'skipped' as const, runId: null };
      }
    }

    // 5. Start the run via the extended runner. Always use 'pipeline' as
    //    the trigger so matrix siblings don't cancel each other via the
    //    engine's concurrent-cancellation logic. The user-facing trigger
    //    (manual/webhook/cron) is preserved on the PipelineRun row.
    //
    //    RETRY POLICY: we delegate per-step retry to `startRunExtended`
    //    (which retries only the failing step, not the whole stage).
    //    The previous whole-stage retry loop here was removed because
    //    it caused a quadratic (retry+1)² explosion — a stage with
    //    retry=2 would run each step up to 9 times.
    const retry = stage.retry ?? config?.defaultRetry ?? 0;
    const timeoutMs = stage.timeoutMs ?? config?.defaultTimeoutMs ?? undefined;

    const { runId } = await startRunExtended({
      projectId,
      workflow: stage.workflow,
      trigger: 'pipeline',
      secrets: stage.secrets,
      env: rowEnv,
      cache: stage.cache
        ? {
            key: rowCacheKey ?? stage.cache.key,
            label: stage.name,
            paths: stage.cache.paths,
            restore: true,
            save: true,
          }
        : undefined,
      retry,
      timeoutMs,
      matrixValues,
      matrixIndex: matrixRows.length > 1 ? idx : undefined,
      matrixTotal: matrixRows.length > 1 ? matrixRows.length : undefined,
      pipelineRunId,
      stageId: stage.id,
      label: matrixRows.length > 1
        ? `${stage.name} (${Object.entries(matrixValues).map(([k, v]) => `${k}=${v}`).join(', ')})`
        : stage.name,
      requiresApproval: stage.requiresApproval,
    });

    return { matrixValues, status: 'running' as const, runId };
  }));

  // 6. Wait for all started runs to complete.
  for (const r of results) {
    if (r.runId) {
      runIds.push(r.runId);
      const finalStatus = await waitForRunCompletion(r.runId);
      if (finalStatus === 'failed') stageFailed = true;
      if (finalStatus === 'canceled') stageCanceled = true;
    } else if (r.status === 'skipped') {
      // Per-row skip — counts as not-failed.
    }
  }

  // 7. Retry policy: per-step retry is handled by `startRunExtended`
    //    (which retries only the failing step). The previous whole-stage
    //    retry loop here was removed because it caused a quadratic
    //    (retry+1)² explosion — see the comment in step 5 above.

  // 8. Update the StageRun row.
  const finalStageStatus = stageCanceled
    ? 'canceled'
    : stageFailed
      ? 'failed'
      : 'success';
  await db.stageRun.update({
    where: { id: stageRun.id },
    data: {
      status: finalStageStatus,
      finishedAt: new Date(),
      runIds: JSON.stringify(runIds),
      matrixValues: matrixRows.length > 1 ? JSON.stringify(matrixRows) : null,
    },
  });
  stageResults[stage.id] = finalStageStatus;
}

// `mapRunStatusToStageStatus` was removed — the previous identity
// function was dead code. Run status strings and stage status strings
// use the same vocabulary (running/success/failed/canceled).

/**
 * Poll the DB every 1s until the run reaches a terminal status.
 * Returns the terminal status. Also handles approval waiting — the run
 * is in `waiting_approval` until approved/rejected, which we treat as a
 * non-terminal status here (we keep waiting).
 */
async function waitForRunCompletion(runId: string): Promise<RunStatus> {
  // Safety cap: 24 hours.
  const deadline = Date.now() + 24 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const run = await db.run.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run) return 'failed';
    const status = run.status as RunStatus;
    if (status === 'running' || status === 'queued' || status === 'waiting_approval') {
      await sleep(1000);
      continue;
    }
    return status;
  }
  return 'failed';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function finishPipelineRun(pipelineRunId: string, status: 'success' | 'failed' | 'canceled'): Promise<void> {
  await db.pipelineRun.update({
    where: { id: pipelineRunId },
    data: { status, finishedAt: new Date() },
  });
  // Best-effort pipeline-level notification (uses the first run's project).
  try {
    const pipelineRun = await db.pipelineRun.findUnique({
      where: { id: pipelineRunId },
      include: { pipeline: true },
    });
    if (pipelineRun) {
      const { notifyRunEvent } = await import('./notifications');
      // Find any run associated with this pipeline run to use as the
      // notification subject. If none, skip.
      const firstRun = await db.run.findFirst({
        where: { pipelineRunId },
        orderBy: { startedAt: 'asc' },
      });
      if (firstRun) {
        // Update the run's status if it doesn't match (rare), then fire.
        await notifyRunEvent(firstRun.id, status);
      }
    }
  } catch {
    // Notifications are best-effort.
  }
}

// ---------------------------------------------------------------------------
// Inspection / cancellation
// ---------------------------------------------------------------------------

export async function getPipelineRun(pipelineRunId: string): Promise<{
  pipelineRun: {
    id: string;
    pipelineId: string;
    projectId: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    trigger: string;
  };
  stageRuns: Array<{
    id: string;
    stageId: string;
    stageName: string;
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    matrixValues: string | null;
    runIds: string;
    error: string | null;
  }>;
  runs: Array<{
    id: string;
    workflow: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    exitCode: number | null;
    durationMs: number | null;
    matrixIndex: number | null;
    matrixTotal: number | null;
    label: string | null;
    stageId: string | null;
  }>;
} | null> {
  const pipelineRun = await db.pipelineRun.findUnique({
    where: { id: pipelineRunId },
    include: {
      stageRuns: { orderBy: { stageId: 'asc' } },
      runs: { orderBy: { startedAt: 'asc' } },
    },
  });
  if (!pipelineRun) return null;
  // Strip TypeScript circulars by re-shaping.
  return {
    pipelineRun: {
      id: pipelineRun.id,
      pipelineId: pipelineRun.pipelineId,
      projectId: pipelineRun.projectId,
      status: pipelineRun.status,
      startedAt: pipelineRun.startedAt,
      finishedAt: pipelineRun.finishedAt,
      trigger: pipelineRun.trigger,
    },
    stageRuns: pipelineRun.stageRuns.map(s => ({
      id: s.id,
      stageId: s.stageId,
      stageName: s.stageName,
      status: s.status,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      matrixValues: s.matrixValues,
      runIds: s.runIds,
      error: s.error,
    })),
    runs: pipelineRun.runs.map(r => ({
      id: r.id,
      workflow: r.workflow,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      matrixIndex: r.matrixIndex,
      matrixTotal: r.matrixTotal,
      label: r.label,
      stageId: r.stageId,
    })),
  };
}

export async function cancelPipelineRun(pipelineRunId: string): Promise<void> {
  const pipelineRun = await db.pipelineRun.findUnique({
    where: { id: pipelineRunId },
    include: { stageRuns: true },
  });
  if (!pipelineRun) throw new Error(`Pipeline run ${pipelineRunId} not found`);

  // Cancel all in-progress runs in this pipeline.
  const runs = await db.run.findMany({
    where: {
      pipelineRunId,
      status: { in: ['running', 'queued', 'waiting_approval'] },
    },
  });
  for (const run of runs) {
    try {
      await cancelRun(run.id);
    } catch {
      // Best-effort — continue canceling others.
    }
  }

  // Mark all pending/running stages as canceled.
  for (const stage of pipelineRun.stageRuns) {
    if (stage.status === 'pending' || stage.status === 'running') {
      await db.stageRun.update({
        where: { id: stage.id },
        data: { status: 'canceled', finishedAt: new Date() },
      });
    }
  }

  // Set pipeline run status to canceled.
  await db.pipelineRun.update({
    where: { id: pipelineRunId },
    data: { status: 'canceled', finishedAt: new Date() },
  });
}

// Re-export approval helpers for convenience.
export { approveRun, rejectRun };
