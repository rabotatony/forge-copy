// ============================================================
// Forge — execution engine (Phase 2)
// ============================================================
// Extends the basic runner with:
//   • Secrets + env var injection (masked in logs)
//   • Content-addressed cache (restore before, save after)
//   • Per-step retry on failure
//   • Per-run timeout (kills the process)
//   • Concurrent run cancellation (new run cancels in-progress)
//   • Matrix fan-out (child runs with matrix values)
//   • Approval gates (wait for manual approval before running)
//   • Test report capture (parse JUnit/JSON/TAP output)
// ============================================================

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { db } from '@/lib/db';
import { extractDir, runArtifactDir } from './storage';
import { getWorkflow, type WorkflowStep } from './workflows';
import type { Detection } from './detector';
import type { MatrixRow, ParsedTestReport } from './types';
// Start log rotation (auto-cleanup of old runs).
import './cleanup';
// Start scheduled runs background scheduler.
import { startScheduler } from './scheduler';
startScheduler();
import { buildProcessEnv, getAllSecrets, maskSecrets } from './secrets';
import { restoreCache, saveCache, hasCache } from './cache';

export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled' | 'waiting_approval';

export interface RunEvent {
  type: 'status' | 'log' | 'artifact' | 'done' | 'approval-required' | 'cache-hit' | 'cache-miss' | 'cache-saved' | 'retry' | 'matrix-started' | 'matrix-completed';
  runId: string;
  status?: RunStatus;
  log?: { seq: number; stream: 'stdout' | 'stderr' | 'system'; text: string; ts: number };
  artifact?: { id: string; name: string; size: number };
  exitCode?: number;
  durationMs?: number;
  cacheLabel?: string;
  retryAttempt?: number;
  matrixIndex?: number;
  matrixTotal?: number;
  message?: string;
}

type Listener = (event: RunEvent) => void;
const listeners = new Map<string, Set<Listener>>();
const active = new Map<string, { child: ReturnType<typeof spawn>; canceled: boolean; timeoutTimer?: ReturnType<typeof setTimeout> }>();
const seqCounter = new Map<string, number>();

export function subscribe(runId: string, fn: Listener): () => void {
  let set = listeners.get(runId);
  if (!set) { set = new Set(); listeners.set(runId, set); }
  set.add(fn);
  return () => { set!.delete(fn); if (set!.size === 0) listeners.delete(runId); };
}

export function emit(event: RunEvent): void {
  const set = listeners.get(event.runId);
  if (set) for (const fn of set) fn(event);
}

// Maximum log lines per run (prevents unbounded DB growth).
const MAX_LOG_LINES_PER_RUN = 10000;
const logLineCounts = new Map<string, number>();

export async function appendLog(runId: string, stream: 'stdout' | 'stderr' | 'system', text: string): Promise<void> {
  // Enforce log line limit per run.
  const count = logLineCounts.get(runId) ?? 0;
  if (count >= MAX_LOG_LINES_PER_RUN) {
    // Once limit reached, only allow system messages (errors, status).
    if (stream !== 'system') return;
    // For system messages, check if we already logged the truncation warning.
    if (count >= MAX_LOG_LINES_PER_RUN + 1) return;
  }

  // Truncate very long lines (prevent memory issues).
  const truncated = text.length > 10000 ? text.slice(0, 10000) + '…[truncated]' : text;

  const seq = seqCounter.get(runId) ?? 0;
  seqCounter.set(runId, seq + 1);
  logLineCounts.set(runId, count + 1);
  const ts = Date.now();
  await db.logLine.create({ data: { runId, seq, stream, text: truncated } });
  emit({ type: 'log', runId, log: { seq, stream, text: truncated, ts } });

  // Log truncation warning once.
  if (count === MAX_LOG_LINES_PER_RUN - 1) {
    const warnSeq = seq + 1;
    seqCounter.set(runId, warnSeq + 1);
    logLineCounts.set(runId, count + 2);
    const warnText = `⚠ Log limit reached (${MAX_LOG_LINES_PER_RUN} lines). Further output suppressed.`;
    await db.logLine.create({ data: { runId, seq: warnSeq, stream: 'system', text: warnText } });
    emit({ type: 'log', runId, log: { seq: warnSeq, stream: 'system', text: warnText, ts: Date.now() } });
  }
}

// ---------------------------------------------------------------------------
// Extended run options
// ---------------------------------------------------------------------------

export interface RunOptions {
  projectId: string;
  workflow: string;
  trigger?: 'manual' | 'auto' | 'webhook' | 'cron' | 'pipeline';
  secrets?: string[];
  env?: Record<string, string>;
  cache?: {
    key: string;
    label: string;
    paths: string[];
    restore: boolean;
    save: boolean;
  };
  retry?: number;
  timeoutMs?: number;
  matrixValues?: MatrixRow;
  matrixIndex?: number;
  matrixTotal?: number;
  parentRunId?: string;
  pipelineRunId?: string;
  // Concurrency group: if set, runs in the same group are serialized
  // (or cancel in-progress runs if cancelInProgress is true).
  concurrencyGroup?: string;
  stageId?: string;
  label?: string;
  testReport?: { format: 'junit' | 'json' | 'tap'; path: string };
  requiresApproval?: boolean;
  reRunOfId?: string;
}

// ---------------------------------------------------------------------------
// Concurrent cancellation
// ---------------------------------------------------------------------------

async function cancelInprogressRuns(projectId: string): Promise<string[]> {
  const inProgress = await db.run.findMany({
    where: { projectId, status: 'running' },
  });
  const canceled: string[] = [];
  for (const run of inProgress) {
    const entry = active.get(run.id);
    if (entry) {
      entry.canceled = true;
      try { entry.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    await appendLog(run.id, 'system', 'Run canceled: a newer run was triggered (concurrent cancellation).');
    await finishRun(run.id, 'canceled', 130);
    canceled.push(run.id);
  }
  return canceled;
}

// ---------------------------------------------------------------------------
// Approval gates
// ---------------------------------------------------------------------------

async function waitForApproval(runId: string): Promise<boolean> {
  await db.approval.create({
    data: { runId, status: 'pending', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  emit({ type: 'approval-required', runId, message: 'Manual approval required to start this run.' });
  await appendLog(runId, 'system', '⏸ Manual approval required. Waiting for approval...');

  // Poll for decision (every 2 seconds, up to 24 hours).
  const deadline = Date.now() + 24 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const approval = await db.approval.findUnique({ where: { runId } });
    if (!approval) return false;
    if (approval.status === 'approved') {
      await appendLog(runId, 'system', `✓ Approved by ${approval.decidedBy ?? 'unknown'}. Starting run...`);
      return true;
    }
    if (approval.status === 'rejected') {
      await appendLog(runId, 'system', `✗ Rejected by ${approval.decidedBy ?? 'unknown'}.`);
      return false;
    }
    if (approval.status === 'expired') return false;
    // Check if run was canceled externally
    const run = await db.run.findUnique({ where: { id: runId } });
    if (run?.status === 'canceled') return false;
  }
  await db.approval.update({ where: { runId }, data: { status: 'expired' } });
  await appendLog(runId, 'system', 'Approval timed out after 24 hours.');
  return false;
}

export async function approveRun(runId: string, decidedBy: string, reason?: string): Promise<void> {
  await db.approval.update({
    where: { runId },
    data: { status: 'approved', decidedAt: new Date(), decidedBy, reason },
  });
}

export async function rejectRun(runId: string, decidedBy: string, reason?: string): Promise<void> {
  await db.approval.update({
    where: { runId },
    data: { status: 'rejected', decidedAt: new Date(), decidedBy, reason },
  });
}

// ---------------------------------------------------------------------------
// Matrix expansion
// ---------------------------------------------------------------------------

export function expandMatrix(dimensions: Array<{ key: string; values: string[] }>, exclude: MatrixRow[] = [], include: MatrixRow[] = []): MatrixRow[] {
  if (dimensions.length === 0) return [{}];
  const results: MatrixRow[] = [{}];
  for (const dim of dimensions) {
    const next: MatrixRow[] = [];
    for (const row of results) {
      for (const value of dim.values) {
        next.push({ ...row, [dim.key]: value });
      }
    }
    results.splice(0, results.length, ...next);
  }
  // Apply excludes
  const filtered = results.filter(row => !exclude.some(ex => matchesRow(row, ex)));
  // Apply includes
  return [...filtered, ...include];
}

function matchesRow(row: MatrixRow, pattern: MatrixRow): boolean {
  return Object.entries(pattern).every(([k, v]) => row[k] === v);
}

// ---------------------------------------------------------------------------
// Public: start an extended run
// ---------------------------------------------------------------------------

export async function startRunExtended(options: RunOptions): Promise<{ runId: string }> {
  const project = await db.project.findUnique({ where: { id: options.projectId } });
  if (!project) throw new Error(`Project ${options.projectId} not found`);
  const workflow = getWorkflow(options.workflow);
  if (!workflow) throw new Error(`Unknown workflow: ${options.workflow}`);

  const detection = JSON.parse(project.detection) as Detection;

  // Concurrency control:
  // 1. If the run has a concurrencyGroup, cancel or queue based on settings.
  // 2. If project has concurrentCancellation enabled, cancel in-progress runs.
  if (options.trigger !== 'pipeline') {
    const settings = await db.projectSettings.findUnique({ where: { projectId: options.projectId } });
    const group = options.concurrencyGroup ?? settings?.concurrencyGroup ?? null;

    if (group) {
      // Concurrency group: either cancel in-progress runs in the same group
      // (if cancelInProgress) or wait for them (serialized).
      const inProgressInGroup = await db.run.findMany({
        where: {
          projectId: options.projectId,
          concurrencyGroup: group,
          status: { in: ['running', 'queued', 'waiting_approval'] },
        },
      });

      if (inProgressInGroup.length > 0) {
        if (settings?.cancelInProgress) {
          // Cancel all in-progress runs in this group.
          for (const run of inProgressInGroup) {
            const entry = active.get(run.id);
            if (entry) {
              entry.canceled = true;
              try { entry.child.kill('SIGTERM'); } catch { /* ignore */ }
            }
            await appendLog(run.id, 'system', `Run canceled: a newer run in group "${group}" was triggered.`);
            await finishRun(run.id, 'canceled', 130);
          }
          await sleep(100);
        } else {
          // Serialized mode: create the run as "queued" and wait in a
          // background poll loop until all in-progress runs in the group
          // reach a terminal state. Then promote this run to "running".
          // This is true queueing (GitHub Actions concurrency: queue).
          const queuedRun = await db.run.create({
            data: {
              projectId: options.projectId,
              workflow: options.workflow,
              status: 'queued',
              trigger: options.trigger ?? 'manual',
              startedAt: new Date(),
              concurrencyGroup: group,
              timeoutMs: options.timeoutMs ?? null,
              requiresApproval: options.requiresApproval ?? false,
              label: options.label ?? null,
            },
          });
          emit({ type: 'status', runId: queuedRun.id, status: 'queued' });

          // Background: wait for in-progress runs to finish, then execute.
          void (async () => {
            const waitDeadline = Date.now() + 24 * 60 * 60 * 1000; // 24h max wait
            while (Date.now() < waitDeadline) {
              await sleep(2000);
              // Check if any runs in this group are still in-progress.
              const stillRunning = await db.run.findFirst({
                where: {
                  projectId: options.projectId,
                  concurrencyGroup: group,
                  status: { in: ['running', 'queued', 'waiting_approval'] },
                  id: { not: queuedRun.id },
                },
              });
              if (!stillRunning) break;
            }
            // Promote to running and execute.
            await db.run.update({ where: { id: queuedRun.id }, data: { status: 'running' } });
            emit({ type: 'status', runId: queuedRun.id, status: 'running' });
            await appendLog(queuedRun.id, 'system', '▶ Run started (was queued in concurrency group).');
            // Execute the workflow on this run.
            await executeQueuedRun(queuedRun.id, options);
          })();

          return { runId: queuedRun.id };
        }
      }
    } else if (settings?.concurrentCancellation ?? true) {
      // Default: cancel all in-progress runs on this project.
      const canceled = await cancelInprogressRuns(options.projectId);
      if (canceled.length > 0) {
        await sleep(100);
      }
    }
  }

  const run = await db.run.create({
    data: {
      projectId: options.projectId,
      workflow: options.workflow,
      status: options.requiresApproval ? 'waiting_approval' : 'running',
      trigger: options.trigger ?? 'manual',
      startedAt: new Date(),
      matrixValues: options.matrixValues ? JSON.stringify(options.matrixValues) : null,
      matrixIndex: options.matrixIndex,
      matrixTotal: options.matrixTotal,
      parentRunId: options.parentRunId,
      pipelineRunId: options.pipelineRunId,
      stageId: options.stageId,
      reRunOfId: options.reRunOfId,
      timeoutMs: options.timeoutMs ?? null,
      requiresApproval: options.requiresApproval ?? false,
      label: options.label ?? null,
      concurrencyGroup: options.concurrencyGroup ?? null,
    },
  });

  emit({ type: 'status', runId: run.id, status: options.requiresApproval ? 'waiting_approval' : 'running' });

  // Run in background.
  void (async () => {
    try {
      // Approval gate
      if (options.requiresApproval) {
        const approved = await waitForApproval(run.id);
        if (!approved) {
          await finishRun(run.id, 'canceled', 130);
          return;
        }
        await db.run.update({ where: { id: run.id }, data: { status: 'running' } });
        emit({ type: 'status', runId: run.id, status: 'running' });
      }

      const steps = workflow.build(detection);
      if (!steps || steps.length === 0) {
        await appendLog(run.id, 'system', `Workflow ${options.workflow} has no steps for this project.`);
        await finishRun(run.id, 'failed', 1);
        return;
      }

      // Substitute matrix values in step commands.
      const substitutedSteps = options.matrixValues
        ? steps.map(s => ({ ...s, command: substituteMatrix(s.command, options.matrixValues!), label: substituteMatrix(s.label, options.matrixValues!) }))
        : steps;

      // Build env with secrets + matrix values.
      const secretsList = options.secrets ?? [];
      const extraEnv: Record<string, string> = { ...options.env };
      if (options.matrixValues) {
        for (const [k, v] of Object.entries(options.matrixValues)) {
          extraEnv[`MATRIX_${k.toUpperCase()}`] = v;
        }
      }
      const allSecrets = secretsList.length > 0 ? await getAllSecrets(options.projectId) : {};

      // Cache restore.
      if (options.cache?.restore) {
        const cacheExists = await hasCache(options.projectId, options.cache.key);
        if (cacheExists) {
          const restored = await restoreCache(options.projectId, options.cache.key);
          if (restored.hit) {
            emit({ type: 'cache-hit', runId: run.id, cacheLabel: options.cache.label });
            await appendLog(run.id, 'system', `💾 Cache hit: ${options.cache.label} (${formatBytes(restored.size ?? 0)})`);
          }
        } else {
          emit({ type: 'cache-miss', runId: run.id, cacheLabel: options.cache.label });
          await appendLog(run.id, 'system', `💾 Cache miss: ${options.cache.label}`);
        }
      }

      // Execute.
      const startedAt = Date.now();
      let lastExitCode = 0;

      if (options.workflow === 'parse' || options.workflow === 'bundle') {
        lastExitCode = await runAxiomWorkflow(run.id, project.extractedPath, options.workflow, options.matrixValues);
      } else {
        for (const step of substitutedSteps) {
          if (active.get(run.id)?.canceled) {
            await finishRun(run.id, 'canceled', 130, Date.now() - startedAt);
            return;
          }
          const maxAttempts = (options.retry ?? 0) + 1;
          let attempt = 0;
          let stepExitCode = 1;
          while (attempt < maxAttempts) {
            if (attempt > 0) {
              emit({ type: 'retry', runId: run.id, retryAttempt: attempt });
              await appendLog(run.id, 'system', `↻ Retry ${attempt}/${maxAttempts - 1} for: ${step.label}`);
            }
            await appendLog(run.id, 'system', `▶ ${step.label}`);
            stepExitCode = await runShellStep(
              run.id,
              step,
              project.extractedPath,
              { secrets: allSecrets, extraEnv, timeoutMs: options.timeoutMs },
            );
            if (stepExitCode === 0) break;
            attempt++;
          }
          if (stepExitCode !== 0) {
            lastExitCode = stepExitCode;
            await appendLog(run.id, 'system', `✗ Step failed with exit code ${stepExitCode} after ${attempt} attempt(s).`);
            await finishRun(run.id, 'failed', stepExitCode, Date.now() - startedAt);
            // Cache save even on failure (partial cache is still useful).
            if (options.cache?.save) {
              try {
                await saveCache(options.projectId, options.cache.key, options.cache.label, options.cache.paths);
                emit({ type: 'cache-saved', runId: run.id, cacheLabel: options.cache.label });
                await appendLog(run.id, 'system', `💾 Cache saved: ${options.cache.label}`);
              } catch (err) {
                await appendLog(run.id, 'system', `Cache save failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            return;
          }
          await appendLog(run.id, 'system', `✓ ${step.label}`);
        }
      }

      // Test report capture.
      if (options.testReport) {
        try {
          const reportPath = path.join(project.extractedPath, options.testReport.path);
          if (fs.existsSync(reportPath)) {
            const content = fs.readFileSync(reportPath, 'utf-8');
            const { parseJUnit, parseJSONReport, parseTAP } = await import('./test-report');
            let report: ParsedTestReport;
            if (options.testReport.format === 'junit') report = parseJUnit(content);
            else if (options.testReport.format === 'json') report = parseJSONReport(content);
            else report = parseTAP(content);
            await db.testReport.create({
              data: {
                runId: run.id,
                format: report.format,
                total: report.total,
                passed: report.passed,
                failed: report.failed,
                skipped: report.skipped,
                duration: report.duration ?? null,
                suites: JSON.stringify(report.suites),
              },
            });
            await appendLog(run.id, 'system', `📊 Test report: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.total} total).`);
          }
        } catch (err) {
          await appendLog(run.id, 'system', `Test report parsing failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Capture artifacts.
      await captureArtifacts(run.id, options.workflow, detection, project.extractedPath);

      // Cache save on success.
      if (options.cache?.save) {
        try {
          const { size } = await saveCache(options.projectId, options.cache.key, options.cache.label, options.cache.paths);
          emit({ type: 'cache-saved', runId: run.id, cacheLabel: options.cache.label });
          await appendLog(run.id, 'system', `💾 Cache saved: ${options.cache.label} (${formatBytes(size)})`);
        } catch (err) {
          await appendLog(run.id, 'system', `Cache save failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      await finishRun(run.id, 'success', lastExitCode, Date.now() - startedAt);
    } catch (err) {
      await appendLog(run.id, 'system', `Runner crashed: ${err instanceof Error ? err.message : String(err)}`);
      await finishRun(run.id, 'failed', -1);
    }
  })();

  return { runId: run.id };
}

// Backward-compatible wrapper.
export async function startRun(args: { projectId: string; workflow: string; trigger?: 'manual' | 'auto' }): Promise<{ runId: string }> {
  return startRunExtended({
    projectId: args.projectId,
    workflow: args.workflow,
    trigger: args.trigger ?? 'manual',
  });
}

/**
 * Execute a queued run after its concurrency group is free.
 * Reuses the same logic as startRunExtended but skips the concurrency check
 * (the run is already queued, so it's allowed to run now).
 */
async function executeQueuedRun(runId: string, options: RunOptions): Promise<void> {
  try {
    const project = await db.project.findUnique({ where: { id: options.projectId } });
    if (!project) throw new Error(`Project ${options.projectId} not found`);
    const workflow = getWorkflow(options.workflow);
    if (!workflow) throw new Error(`Unknown workflow: ${options.workflow}`);

    const detection = JSON.parse(project.detection) as Detection;
    const steps = workflow.build(detection);
    if (!steps || steps.length === 0) {
      await appendLog(runId, 'system', `Workflow ${options.workflow} has no steps.`);
      await finishRun(runId, 'failed', 1);
      return;
    }

    const secretsList = options.secrets ?? [];
    const extraEnv: Record<string, string> = { ...options.env };
    const allSecrets = secretsList.length > 0 ? await getAllSecrets(options.projectId) : {};

    const startedAt = Date.now();
    let lastExitCode = 0;

    for (const step of steps) {
      if (active.get(runId)?.canceled) {
        await finishRun(runId, 'canceled', 130, Date.now() - startedAt);
        return;
      }
      await appendLog(runId, 'system', `▶ ${step.label}`);
      const stepExitCode = await runShellStep(
        runId,
        step,
        project.extractedPath,
        { secrets: allSecrets, extraEnv, timeoutMs: options.timeoutMs },
      );
      if (stepExitCode !== 0) {
        lastExitCode = stepExitCode;
        await appendLog(runId, 'system', `✗ Step failed with exit code ${stepExitCode}.`);
        await finishRun(runId, 'failed', stepExitCode, Date.now() - startedAt);
        return;
      }
      await appendLog(runId, 'system', `✓ ${step.label}`);
    }

    // Capture artifacts.
    await captureArtifacts(runId, options.workflow, detection, project.extractedPath);
    await finishRun(runId, 'success', lastExitCode, Date.now() - startedAt);
  } catch (err) {
    await appendLog(runId, 'system', `Runner crashed: ${err instanceof Error ? err.message : String(err)}`);
    await finishRun(runId, 'failed', -1);
  }
}

export async function cancelRun(runId: string): Promise<void> {
  const entry = active.get(runId);
  if (entry) {
    entry.canceled = true;
    try { entry.child.kill('SIGTERM'); } catch { /* ignore */ }
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
  }
  await appendLog(runId, 'system', 'Run canceled by user');
  await finishRun(runId, 'canceled', 130);
}

// ---------------------------------------------------------------------------
// Step execution (with secrets masking + timeout)
// ---------------------------------------------------------------------------

interface StepEnvOptions {
  secrets: Record<string, string>;
  extraEnv: Record<string, string>;
  timeoutMs?: number;
}

async function runShellStep(
  runId: string,
  step: WorkflowStep,
  cwd: string,
  envOptions: StepEnvOptions,
): Promise<number> {
  return new Promise((resolve) => {
    // Security: block known-dangerous commands.
    const BLOCKED_PATTERNS = [
      /\/etc\/(passwd|shadow|sudoers)/i,
      /\/proc\/self\/(environ|cmdline)/i,
      /\brm\s+-rf\s+\//i,
      /\bmkfs\b/i,
      /\bdd\s+if=\/dev\//i,
      /:\(\)\s*\{/i,  // fork bomb
    ];
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(step.command)) {
        void appendLog(runId, 'system', `🚫 Command blocked by security policy: ${step.command.slice(0, 80)}`);
        resolve(126);
        return;
      }
    }

    const projectRoot = cwd;
    buildProcessEnv('', { extraEnv: envOptions.extraEnv, projectRoot }).then((baseEnv) => {
      const fullEnv = { ...baseEnv, ...envOptions.secrets };
      const child = spawn('bash', ['-c', step.command], {
        cwd,
        env: fullEnv as NodeJS.ProcessEnv,
      }) as import('node:child_process').ChildProcessWithoutNullStreams;
      active.set(runId, { child, canceled: false });

      // Timeout
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
        resolve(code ?? 0);
      });
      child.on('error', (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        void appendLog(runId, 'system', `spawn error: ${err.message}`);
        active.delete(runId);
        resolve(1);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// AxiomState workflow (parse / bundle)
// ---------------------------------------------------------------------------

async function runAxiomWorkflow(
  runId: string,
  projectRoot: string,
  key: 'parse' | 'bundle',
  matrixValues?: MatrixRow,
): Promise<number> {
  try {
    const { parseProject, writeGraph, sliceForward } = await import('@/lib/axiomstate/phase1');
    const { bundleFiles } = await import('@/lib/axiomstate/phase2');
    const { LSSKernel } = await import('@/lib/axiomstate/phase0/kernel');

    const kernelDir = path.join(extractDir(''), '..', `kernel-${runId}`);
    fs.mkdirSync(kernelDir, { recursive: true });
    const kernel = new LSSKernel(kernelDir);

    await appendLog(runId, 'system', `AxiomState: parsing project at ${projectRoot}`);
    const delta = parseProject(projectRoot);
    const seq = writeGraph(kernel, delta, { checkpoint: false, providerName: 'typescript+regex' });
    await appendLog(runId, 'stdout', `Parsed ${delta.nodes.length} nodes and ${delta.edges.length} edges (seq=${seq}).`);
    if (matrixValues) {
      await appendLog(runId, 'system', `Matrix: ${JSON.stringify(matrixValues)}`);
    }

    if (key === 'parse') {
      for (const node of delta.nodes) {
        await appendLog(runId, 'stdout', `  ${node.kind.padEnd(6)} ${node.id}  (deps: ${node.deps.length})`);
      }
    } else {
      const indexNode = delta.nodes.find(n => n.kind === 'file' && /index\.(ts|js|tsx|jsx)$/.test(n.name));
      if (!indexNode) {
        await appendLog(runId, 'stderr', 'No index.(ts|js|tsx|jsx) entry found — cannot bundle.');
        return 1;
      }
      await appendLog(runId, 'system', `AxiomState: bundling forward slice from ${indexNode.id}`);
      const slice = sliceForward(kernel, indexNode.id);
      const fileIds = Array.from(slice.nodes.values()).filter(n => n.kind === 'file').map(n => n.id);
      const bundle = bundleFiles(kernel, fileIds);
      await appendLog(runId, 'stdout', `Bundle order (${bundle.order.length} files):`);
      for (const id of bundle.order) await appendLog(runId, 'stdout', `  • ${id}`);
      if (bundle.cycles.length > 0) {
        await appendLog(runId, 'stderr', `Cycles detected: ${bundle.cycles.length}`);
        for (const cycle of bundle.cycles) await appendLog(runId, 'stderr', `  ↻ ${cycle.join(' → ')}`);
      }
      const artifactDir = runArtifactDir(runId);
      const outPath = path.join(artifactDir, 'bundle.js');
      const parts: Buffer[] = [];
      for (const entry of bundle.entries) {
        parts.push(Buffer.from(`\n// --- ${entry.path} ---\n`));
        parts.push(Buffer.from(entry.content));
      }
      fs.writeFileSync(outPath, Buffer.concat(parts));
      const stat = fs.statSync(outPath);
      const artifact = await db.artifact.create({
        data: { runId, name: 'bundle.js', path: outPath, size: stat.size, mime: 'text/javascript' },
      });
      emit({ type: 'artifact', runId, artifact: { id: artifact.id, name: artifact.name, size: artifact.size } });
      await appendLog(runId, 'system', `Artifact written: bundle.js (${stat.size} bytes)`);
    }

    kernel.close();
    try { fs.rmSync(kernelDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return 0;
  } catch (err) {
    await appendLog(runId, 'stderr', `AxiomState error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

async function captureArtifacts(
  runId: string,
  workflowKey: string,
  detection: Detection,
  projectRoot: string,
): Promise<void> {
  const workflow = getWorkflow(workflowKey);
  if (!workflow?.producesArtifacts) return;
  const specs = workflow.producesArtifacts(detection, projectRoot);
  if (specs.length === 0) return;

  const artifactDir = runArtifactDir(runId);
  for (const spec of specs) {
    // Case 1: directory glob like "dist/**/*" — zip the whole directory.
    const dirMatch = spec.glob.match(/^(.+?)\/\*\*\/\*$/);
    if (dirMatch) {
      const dir = dirMatch[1]!;
      const fullDir = path.join(projectRoot, dir);
      if (!fs.existsSync(fullDir)) continue;
      const zipPath = path.join(artifactDir, `${spec.name}.zip`);
      await zipDirectory(fullDir, zipPath);
      const stat = fs.statSync(zipPath);
      const artifact = await db.artifact.create({
        data: { runId, name: `${spec.name}.zip`, path: zipPath, size: stat.size, mime: 'application/zip' },
      });
      emit({ type: 'artifact', runId, artifact: { id: artifact.id, name: artifact.name, size: artifact.size } });
      await appendLog(runId, 'system', `Artifact captured: ${artifact.name} (${stat.size} bytes)`);
      continue;
    }

    // Case 2: single file like "forge-apk-output/app-release.apk" — copy as-is.
    const fullPath = path.join(projectRoot, spec.glob);
    if (!fs.existsSync(fullPath)) {
      await appendLog(runId, 'system', `Artifact not found at expected path: ${spec.glob}`);
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) continue; // skip dirs without /**/*
    // Copy the file to the artifact directory, preserving the original name.
    const destName = spec.name || path.basename(fullPath);
    const destPath = path.join(artifactDir, destName);
    fs.copyFileSync(fullPath, destPath);
    const artifact = await db.artifact.create({
      data: { runId, name: destName, path: destPath, size: stat.size, mime: spec.mime },
    });
    emit({ type: 'artifact', runId, artifact: { id: artifact.id, name: artifact.name, size: artifact.size } });
    await appendLog(runId, 'system', `Artifact captured: ${artifact.name} (${stat.size} bytes)`);
  }
}

async function zipDirectory(srcDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-r', '-q', outPath, '.'], { cwd: srcDir });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`zip exited with ${code}`)));
    child.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function finishRun(
  runId: string,
  status: RunStatus,
  exitCode: number,
  durationMs?: number,
): Promise<void> {
  seqCounter.delete(runId);
  logLineCounts.delete(runId);
  await db.run.update({
    where: { id: runId },
    data: {
      status,
      exitCode,
      finishedAt: new Date(),
      durationMs: durationMs ?? 0,
    },
  });
  emit({ type: 'done', runId, status, exitCode, durationMs });

  // Fire notifications (import lazily to avoid circular deps).
  try {
    const { notifyRunEvent } = await import('./notifications');
    await notifyRunEvent(runId, status);
  } catch { /* notifications not ready yet */ }
}

function substituteMatrix(text: string, matrix: MatrixRow): string {
  return text.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => matrix[key] ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
