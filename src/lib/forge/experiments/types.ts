// ============================================================
// Forge — Experiments Lab types
// ============================================================
// Pure type module for the experiments subsystem. No runtime logic, no
// side effects. Imported by definitions.ts, runner.ts, promote.ts, llm.ts
// and re-exported via index.ts so external callers can import from
// '@/lib/forge/experiments' (the barrel) or '@/lib/forge/experiments/engine'
// (the legacy path that just re-exports from this barrel).
// ============================================================

export type ExperimentCategory =
  | 'self-improvement'
  | 'tournament'
  | 'synthesis'
  | 'adversarial'
  | 'recursive'
  | 'breakthrough';

export type Verdict = 'BREAKTHROUGH' | 'NO_CHANGE' | 'REGRESSION';
export type RunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'killed';

export interface ExperimentDefinition {
  slug: string;
  name: string;
  category: ExperimentCategory;
  hypothesis: string;
  procedure: string;
  dangerLevel: 'safe' | 'moderate' | 'aggressive';
  /** Runs the experiment. Returns evidence + metrics + verdict. */
  run: (ctx: RunContext) => Promise<RunResult>;
}

export interface RunContext {
  runId: string;
  workDir: string;
  log: (step: string, detail: unknown) => void;
  /** Generate a script via the LLM. Throws on timeout/failure. */
  generate: (prompt: string, language: 'bash' | 'python' | 'node') => Promise<GeneratedScript>;
  /** Execute a script in the sandbox. Returns stdout/stderr/exit/duration. */
  execute: (script: GeneratedScript, opts?: ExecOpts) => Promise<ExecResult>;
  /** Hard deadline (epoch ms). Experiments should check this between steps. */
  deadline: number;
}

export interface GeneratedScript {
  language: 'bash' | 'python' | 'node';
  filename: string;
  code: string;
  description: string;
}

export interface ExecOpts {
  /** Per-script timeout. Default 10_000, max 30_000. */
  timeoutMs?: number;
  /** Stdin to feed the process. */
  stdin?: string;
  /** Extra env vars. */
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface RunResult {
  verdict: Verdict;
  verdictReason: string;
  metrics: Record<string, number | string | boolean | undefined>;
  summary: string;
}
