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

import { db } from '@/lib/db';
import {
  startRunExtended,
  cancelRun,
  expandMatrix,
  approveRun,
  rejectRun,
} from './engine';
import type { RunStatus } from './engine';
import type {
  MatrixRow,
  PipelineDefinition,
  PipelineStage,
} from './types';
import { runCustomWorkflow } from './custom-workflow';

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
// Matrix substitution
// ---------------------------------------------------------------------------

function substituteMatrix(text: string, matrix: MatrixRow): string {
  return text.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => matrix[key] ?? '');
}

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

// ---------------------------------------------------------------------------
// Execution
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
            status: mapRunStatusToStageStatus(finalStatus),
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

  // 7. Retry the whole stage on failure (up to `retry` times).
  let attempt = 0;
  const maxAttempts = (stage.retry ?? 0) + 1;
  // Note: startRunExtended already does per-step retry, but here we retry
  // the whole stage if any matrix row failed. We've already started the
  // first attempt above; additional attempts only happen if stageFailed.

  while ((stageFailed || stageCanceled) && attempt < maxAttempts - 1 && runIds.length > 0) {
    attempt++;
    // Cancel existing runs (they're already done — failed), then retry.
    stageFailed = false;
    stageCanceled = false;
    const retryRunIds: string[] = [];
    const retryResults = await Promise.all(matrixRows.map(async (matrixValues, idx) => {
      const rowEnv = substituteMatrixInRecord(stage.env, matrixValues);
      const rowCacheKey = stage.cache ? substituteMatrix(stage.cache.key, matrixValues) : undefined;
      const { runId } = await startRunExtended({
        projectId,
        workflow: stage.workflow,
        trigger: 'pipeline',
        secrets: stage.secrets,
        env: rowEnv,
        cache: stage.cache
          ? {
              key: rowCacheKey ?? stage.cache.key,
              label: `${stage.name} (retry ${attempt})`,
              paths: stage.cache.paths,
              restore: true,
              save: true,
            }
          : undefined,
        retry: 0,
        timeoutMs: stage.timeoutMs ?? config?.defaultTimeoutMs ?? undefined,
        matrixValues,
        matrixIndex: matrixRows.length > 1 ? idx : undefined,
        matrixTotal: matrixRows.length > 1 ? matrixRows.length : undefined,
        pipelineRunId,
        stageId: stage.id,
        label: matrixRows.length > 1
          ? `${stage.name} (retry ${attempt}, ${Object.entries(matrixValues).map(([k, v]) => `${k}=${v}`).join(', ')})`
          : `${stage.name} (retry ${attempt})`,
        requiresApproval: false, // Don't re-require approval on retry.
      });
      retryRunIds.push(runId);
      return waitForRunCompletion(runId);
    }));
    const statuses = await Promise.all(retryResults);
    runIds.push(...retryRunIds);
    if (statuses.some(s => s === 'failed')) stageFailed = true;
    if (statuses.some(s => s === 'canceled')) stageCanceled = true;
  }

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

function mapRunStatusToStageStatus(status: RunStatus): string {
  return status;
}

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
