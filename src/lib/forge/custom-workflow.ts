// ============================================================
// Forge — user-authored custom workflows (Phase 2)
// ============================================================
// A CustomWorkflow is a JSON document authored by the project owner
// describing a list of shell steps (with per-step env, retry, timeout,
// cache, working dir, test-report capture, and continueOnError). It is
// the lightweight alternative to defining a multi-stage Pipeline.
//
// Custom workflows share the engine's SSE event bus (via `subscribe`,
// `emit`, `appendLog`, `finishRun` from `./engine`) so the existing
// `/api/forge/runs/[id]/events` SSE route picks them up automatically.
//
// Storage: a custom workflow is stored as a Pipeline with a single
// 'custom' stage and the full CustomWorkflow JSON in the pipeline's
// `config.customWorkflow` field. The pipeline executor detects this
// and dispatches to `runCustomWorkflow` instead of `startRunExtended`.
// ============================================================

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { db } from '@/lib/db';
import {
  subscribe,
  emit,
  appendLog,
  finishRun,
  expandMatrix,
  active, // shared active Map — ensures cancelRun() works for custom workflows
} from './engine';
import type { RunEvent, RunStatus } from './engine';
import {
  buildProcessEnv,
  getAllSecrets,
  getSecrets,
  maskSecrets,
} from './secrets';
import { hasCache, restoreCache, saveCache } from './cache';
import type { CustomWorkflow, CustomWorkflowStep, CustomWorkflowStepLanguage, MatrixRow } from './types';

// Re-export subscribe for the SSE API route to use uniformly.
export { subscribe };

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
// Execution
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
      status: options.matrixValues ? 'running' : 'running',
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
    // Resolve secrets (workflow-level + per-step).
    const secretKeys = new Set<string>(workflow.secrets ?? []);
    for (const step of workflow.steps) {
      // Per-step secrets aren't in CustomWorkflowStep; only workflow-level.
      void step;
    }
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
          { secrets: allSecrets, extraEnv: stepEnv, timeoutMs: step.timeoutMs },
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
            let report;
            if (step.testReport.format === 'junit') report = parseJUnit(content);
            else if (step.testReport.format === 'json') report = parseJSONReport(content);
            else report = parseTAP(content);
            await db.testReport.create({
              data: {
                runId,
                format: report.format,
                total: report.total,
                passed: report.passed,
                failed: report.failed,
                skipped: report.skipped,
                duration: report.duration ?? null,
                suites: JSON.stringify(report.suites),
              },
            });
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
          let report;
          if (workflow.testReport.format === 'junit') report = parseJUnit(content);
          else if (workflow.testReport.format === 'json') report = parseJSONReport(content);
          else report = parseTAP(content);
          await db.testReport.create({
            data: {
              runId,
              format: report.format,
              total: report.total,
              passed: report.passed,
              failed: report.failed,
              skipped: report.skipped,
              duration: report.duration ?? null,
              suites: JSON.stringify(report.suites),
            },
          });
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
// Step execution (with secrets masking + per-step timeout)
// ---------------------------------------------------------------------------

interface StepEnvOptions {
  secrets: Record<string, string>;
  extraEnv: Record<string, string>;
  timeoutMs?: number;
}

// `active` is imported from ./engine — no longer declared here.
// This ensures cancelRun() in engine.ts can find and cancel runs
// started by custom-workflow.ts (previously each had its own Map).

/**
 * Execute a single custom-workflow step. The interpreter is chosen by
 * `step.language`:
 *   - 'bash'   → spawn `bash -c <step.run>` (UNCHANGED from legacy behavior)
 *   - 'node'   → write step.run to <cwd>/.forge-step-<uuid>.mjs, spawn `node <file>`
 *   - 'python' → write step.run to <cwd>/.forge-step-<uuid>.py,  spawn `python3 <file>`
 *   - 'ruby'   → write step.run to <cwd>/.forge-step-<uuid>.rb,  spawn `ruby <file>`
 *
 * The temp file is placed in the step's working dir (cwd) so relative
 * requires/imports resolve correctly. The temp file is deleted best-effort
 * after the process closes (success or error).
 *
 * ALL existing behavior is preserved: BLOCKED_PATTERNS security check
 * (applied to the command text regardless of language), per-step timeout
 * (SIGTERM then SIGKILL after 2s), `active` map tracking, stdout/stderr
 * line streaming with createInterface + appendLog + maskSecrets, env
 * building via buildProcessEnv, and the Promise<number> return type.
 */
async function executeStepCommand(
  runId: string,
  step: CustomWorkflowStep,
  cwd: string,
  envOptions: StepEnvOptions,
): Promise<number> {
  // Defensive: the workflow object may have been loaded from the DB without
  // going through parseCustomWorkflow, so step.language could in theory be
  // anything. Reject unknown languages explicitly rather than falling
  // through to a default interpreter.
  const rawLanguage = step.language ?? 'bash';
  if (!(STEP_LANGUAGES as readonly string[]).includes(rawLanguage)) {
    void appendLog(runId, 'system', `✗ Unknown step language "${String(step.language)}" for step "${step.name}". Allowed: ${STEP_LANGUAGES.join(', ')}.`);
    return Promise.resolve(1);
  }
  const language: CustomWorkflowStepLanguage = rawLanguage;
  const command = step.run;
  return new Promise((resolve) => {
    void (async () => {
      // Security: block known-dangerous commands that read system files.
      // Applied to ALL languages so a ruby/python/node step can't bypass it.
      const BLOCKED_PATTERNS = [
        /\/etc\/(passwd|shadow|sudoers)/i,
        /\/proc\/self\/(environ|cmdline)/i,
        /\brm\s+-rf\s+\//i,
        /\bmkfs\b/i,
        /\bdd\s+if=\/dev\//i,
        /:\(\)\s*\{/i,  // fork bomb
      ];
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
          await appendLog(runId, 'system', `🚫 Command blocked by security policy: ${command.slice(0, 80)}`);
          resolve(126); // 126 = command not executable (security)
          return;
        }
      }

      // Surface which interpreter is being used so users can see it in logs.
      await appendLog(runId, 'system', `▶ Running ${language} step: ${step.name}`);

      const baseEnv = await buildProcessEnv('', {
        extraEnv: envOptions.extraEnv,
        projectRoot: cwd,
      });
      const fullEnv = { ...baseEnv, ...envOptions.secrets };

      // For bash: spawn directly with -c (legacy behavior, unchanged).
      // For node/python/ruby: write the script to a temp file in cwd so
      // relative imports work, then spawn the interpreter with the file.
      let tempFile: string | undefined;
      let spawnCmd: string;
      let spawnArgs: string[];
      if (language === 'bash') {
        spawnCmd = 'bash';
        spawnArgs = ['-c', command];
      } else if (language === 'node') {
        tempFile = path.join(cwd, `.forge-step-${randomUUID()}.mjs`);
        try {
          await fs.promises.writeFile(tempFile, command, 'utf-8');
        } catch (err) {
          await appendLog(runId, 'system', `Failed to write temp script: ${err instanceof Error ? err.message : String(err)}`);
          resolve(1);
          return;
        }
        spawnCmd = 'node';
        spawnArgs = [tempFile];
      } else if (language === 'python') {
        tempFile = path.join(cwd, `.forge-step-${randomUUID()}.py`);
        try {
          await fs.promises.writeFile(tempFile, command, 'utf-8');
        } catch (err) {
          await appendLog(runId, 'system', `Failed to write temp script: ${err instanceof Error ? err.message : String(err)}`);
          resolve(1);
          return;
        }
        spawnCmd = 'python3';
        spawnArgs = [tempFile];
      } else {
        // language === 'ruby'
        tempFile = path.join(cwd, `.forge-step-${randomUUID()}.rb`);
        try {
          await fs.promises.writeFile(tempFile, command, 'utf-8');
        } catch (err) {
          await appendLog(runId, 'system', `Failed to write temp script: ${err instanceof Error ? err.message : String(err)}`);
          resolve(1);
          return;
        }
        spawnCmd = 'ruby';
        spawnArgs = [tempFile];
      }

      // Best-effort cleanup helper. Called from close/error/throw paths.
      const cleanupTempFile = () => {
        if (tempFile) {
          fs.promises.unlink(tempFile).catch(() => { /* ignore */ });
        }
      };

      let child: import('node:child_process').ChildProcessWithoutNullStreams;
      try {
        child = spawn(spawnCmd, spawnArgs, {
          cwd,
          env: fullEnv as NodeJS.ProcessEnv,
        }) as import('node:child_process').ChildProcessWithoutNullStreams;
      } catch (err) {
        cleanupTempFile();
        await appendLog(runId, 'system', `spawn error: ${err instanceof Error ? err.message : String(err)}`);
        resolve(1);
        return;
      }
      active.set(runId, { child, canceled: false });

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      if (envOptions.timeoutMs) {
        timeoutTimer = setTimeout(() => {
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          void appendLog(runId, 'system', `⏱ Step timed out after ${envOptions.timeoutMs}ms. Killing process...`);
          // Force-kill with SIGKILL after 2 seconds if still alive.
          killTimer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            void appendLog(runId, 'system', `⏱ Force-killed (SIGKILL).`);
          }, 2000);
        }, envOptions.timeoutMs);
        active.get(runId)!.timeoutTimer = timeoutTimer;
      }

      const stdout = createInterface({ input: child.stdout });
      const stderr = createInterface({ input: child.stderr });
      stdout.on('line', (line) => { void appendLog(runId, 'stdout', maskSecrets(line, envOptions.secrets)); });
      stderr.on('line', (line) => { void appendLog(runId, 'stderr', maskSecrets(line, envOptions.secrets)); });

      child.on('close', (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        active.delete(runId);
        cleanupTempFile();
        resolve(code ?? 0);
      });
      child.on('error', (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        void appendLog(runId, 'system', `spawn error: ${err.message}`);
        active.delete(runId);
        cleanupTempFile();
        resolve(1);
      });
    })();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function substituteMatrix(text: string, matrix: MatrixRow): string {
  return text.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => matrix[key] ?? '');
}

function substituteMatrixInRecord(rec: Record<string, string>, matrix: MatrixRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = substituteMatrix(v, matrix);
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Re-export matrix expansion for callers that want it.
export { expandMatrix };
