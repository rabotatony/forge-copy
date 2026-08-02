// ============================================================
// Forge — Experiments Lab runner
// ============================================================
// runExperiment(slug) — the public entry point that the API routes call:
//   1. Look up the ExperimentDefinition by slug.
//   2. Persist an ExperimentRun row (status='running').
//   3. Allocate a fresh temp workDir under os.tmpdir().
//   4. Build a RunContext whose generate() wraps generateScript in an
//      AI_TIMEOUT_MS race and whose execute() wraps executeScript.
//   5. Run the experiment's run() inside a Promise.race against the
//      hard MAX_EXPERIMENT_DURATION_MS + 5s cap.
//   6. Persist the verdict, verdictReason, metrics and evidence (the
//      steps log accumulated by ctx.log).
//   7. Best-effort cleanup of the temp dir.
//
// Also exposes the two read-side helpers the API routes need:
//   - listExperimentsWithLatestRun() — merge the static EXPERIMENTS array
//     with the latest DB row per slug, so experiments that have never run
//     still appear in the lab UI.
//   - listRuns(slug, limit) — recent runs for one experiment.
//
// executeScript is private to this module (not exported). It is the
// sandboxed spawn wrapper that enforces the per-script timeout, the
// per-stream output cap and SIGKILL-on-overrun.
// ============================================================

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { db } from '@/lib/db';
import type {
  ExecOpts,
  ExecResult,
  GeneratedScript,
  RunContext,
  RunResult,
  RunStatus,
  Verdict,
} from './types';
import { EXPERIMENTS } from './definitions';
import { generateScript } from './llm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SCRIPT_TIMEOUT = 30_000;
const DEFAULT_SCRIPT_TIMEOUT = 10_000;
const MAX_OUTPUT_BYTES = 200 * 1024; // 200 KB per stream
const AI_TIMEOUT_MS = 180_000; // 3min — allows for LLM rate-limit retries
const MAX_EXPERIMENT_DURATION_MS = 280_000; // ~4.5min — accommodates LLM rate-limit retries

// ---------------------------------------------------------------------------
// Sandboxed spawn — provided to every experiment via ctx.execute()
// ---------------------------------------------------------------------------

/** Spawn a script with a hard timeout + output cap. SIGKILL on overrun. */
function executeScript(
  script: GeneratedScript,
  workDir: string,
  opts: ExecOpts = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT, MAX_SCRIPT_TIMEOUT);
    const filename = script.filename;
    const filePath = path.join(workDir, filename);
    try {
      fs.writeFileSync(filePath, script.code, { mode: 0o755 });
    } catch (err) {
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: `Failed to write script: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
        timedOut: false,
        truncated: false,
      });
      return;
    }

    const start = Date.now();
    let cmd: string;
    let args: string[];
    if (script.language === 'bash') {
      cmd = 'bash';
      args = [filePath];
    } else if (script.language === 'python') {
      cmd = 'python3';
      args = [filePath];
    } else {
      cmd = 'node';
      args = [filePath];
    }

    const child = spawn(cmd, args, {
      cwd: workDir,
      env: { ...process.env, ...opts.env, FORGE_EXPERIMENT: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 0, // we manage the timeout ourselves for SIGKILL reliability
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
        truncated,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stdout.length);
        if (stdout.length >= MAX_OUTPUT_BYTES) truncated = true;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stderr.length);
        if (stderr.length >= MAX_OUTPUT_BYTES) truncated = true;
      }
    });

    if (opts.stdin) {
      try {
        child.stdin?.write(opts.stdin);
      } catch {
        /* ignore */
      }
    }
    child.stdin?.end();

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      finish(-1);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code ?? -1);
    });
  });
}

// ---------------------------------------------------------------------------
// Orchestration: run an experiment end-to-end and persist results
// ---------------------------------------------------------------------------

export async function runExperiment(slug: string): Promise<{ runId: string; verdict: Verdict | null; status: RunStatus }> {
  const def = EXPERIMENTS.find(e => e.slug === slug);
  if (!def) throw new Error(`Unknown experiment: ${slug}`);

  // Ensure the experiment row exists.
  let experiment = await db.experiment.findUnique({ where: { slug } });
  if (!experiment) {
    experiment = await db.experiment.create({
      data: {
        slug: def.slug,
        name: def.name,
        category: def.category,
        hypothesis: def.hypothesis,
        procedure: def.procedure,
        dangerLevel: def.dangerLevel,
      },
    });
  }

  const run = await db.experimentRun.create({
    data: {
      experimentId: experiment.id,
      status: 'running',
      startedAt: new Date(),
    },
  });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `forge-exp-${def.slug}-`));
  const deadline = Date.now() + MAX_EXPERIMENT_DURATION_MS;
  const stepsLog: unknown[] = [];

  const ctx: RunContext = {
    runId: run.id,
    workDir,
    deadline,
    log: (step, detail) => {
      stepsLog.push({ step, detail, t: Date.now() });
    },
    generate: async (prompt, language) => {
      const t0 = Date.now();
      try {
        const result = await Promise.race([
          generateScript(prompt, language),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('AI generation timed out')), AI_TIMEOUT_MS),
          ),
        ]);
        stepsLog.push({ step: `ai-generate-${language}`, detail: { ms: Date.now() - t0, desc: result.description }, t: Date.now() });
        return result;
      } catch (err) {
        stepsLog.push({ step: `ai-generate-${language}-failed`, detail: { ms: Date.now() - t0, err: err instanceof Error ? err.message : String(err) }, t: Date.now() });
        throw err;
      }
    },
    execute: async (script, opts) => {
      const result = await executeScript(script, workDir, opts);
      stepsLog.push({ step: `execute-${script.language}`, detail: { exit: result.exitCode, ms: result.durationMs, timedOut: result.timedOut }, t: Date.now() });
      return result;
    },
  };

  let status: RunStatus = 'completed';
  let result: RunResult;
  try {
    result = await Promise.race([
      def.run(ctx),
      new Promise<RunResult>((_, reject) =>
        setTimeout(() => reject(new Error('Experiment exceeded hard cap')), MAX_EXPERIMENT_DURATION_MS + 5_000),
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    status = msg.includes('timed out') || msg.includes('exceeded') ? 'timeout' : 'failed';
    result = {
      verdict: 'REGRESSION',
      verdictReason: `Experiment threw: ${msg}`,
      metrics: { error: msg },
      summary: `Experiment failed: ${msg}`,
    };
  }

  // Cleanup the temp dir (best-effort).
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  await db.experimentRun.update({
    where: { id: run.id },
    data: {
      status,
      verdict: result.verdict,
      verdictReason: result.verdictReason,
      metrics: JSON.stringify(result.metrics),
      evidence: JSON.stringify({ summary: result.summary, steps: stepsLog }),
      completedAt: new Date(),
    },
  });

  return { runId: run.id, verdict: result.verdict, status };
}

// ---------------------------------------------------------------------------
// List helpers
// ---------------------------------------------------------------------------

export async function listExperimentsWithLatestRun() {
  const rows = await db.experiment.findMany({
    include: {
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 1,
      },
      _count: { select: { runs: true } },
    },
    orderBy: { category: 'asc' },
  });
  // Merge the static definitions (hypothesis/procedure) with DB rows so
  // experiments that have never run still appear.
  const bySlug = new Map(rows.map(r => [r.slug, r]));
  return EXPERIMENTS.map(def => {
    const row = bySlug.get(def.slug);
    return {
      slug: def.slug,
      name: def.name,
      category: def.category,
      hypothesis: def.hypothesis,
      procedure: def.procedure,
      dangerLevel: def.dangerLevel,
      dbId: row?.id ?? null,
      totalRuns: row?._count.runs ?? 0,
      latestRun: row?.runs[0] ?? null,
    };
  });
}

export async function listRuns(slug: string, limit = 20) {
  const exp = await db.experiment.findUnique({ where: { slug } });
  if (!exp) return [];
  return db.experimentRun.findMany({
    where: { experimentId: exp.id },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}
