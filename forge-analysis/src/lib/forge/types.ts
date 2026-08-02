// ============================================================
// Forge — shared types for Phase 2+ features
// ============================================================

// Matrix definition for fan-out builds
export interface MatrixDimension {
  key: string;       // e.g. "node_version"
  values: string[];  // e.g. ["18", "20", "22"]
}

export interface MatrixConfig {
  dimensions: MatrixDimension[];
  // Optional: exclude/include rules
  exclude?: MatrixRow[];
  include?: MatrixRow[];
}

export type MatrixRow = Record<string, string>;

// Multi-stage pipeline definition
export interface PipelineStage {
  id: string;                 // unique within pipeline
  name: string;               // human-readable
  workflow: string;           // workflow key
  needs: string[];            // stage IDs that must complete first
  matrix?: MatrixConfig;      // fan-out config
  retry?: number;             // auto-retry count on failure
  timeoutMs?: number;         // per-stage timeout
  requiresApproval?: boolean; // manual approval gate
  secrets?: string[];         // secret keys to inject as env vars
  env?: Record<string, string>; // extra env vars
  cache?: {
    key: string;              // cache key (can use ${{ matrix.x }} substitution)
    paths: string[];          // paths to cache (relative to project root)
  };
  // Skip condition (simple expression, e.g. "matrix.node_version == '18'")
  if?: string;
}

export interface PipelineDefinition {
  stages: PipelineStage[];
  config: {
    concurrentCancellation?: boolean;
    defaultRetry?: number;
    defaultTimeoutMs?: number;
    notifications?: string[]; // events: started, success, failure, always
  };
}

// Interpreter used to execute a custom workflow step.
// - 'bash'   → spawn `bash -c <run>` (default, unchanged behavior)
// - 'node'   → write `run` to a temp `.mjs` file and spawn `node <file>`
// - 'python' → write `run` to a temp `.py`  file and spawn `python3 <file>`
// - 'ruby'   → write `run` to a temp `.rb`  file and spawn `ruby <file>`
export type CustomWorkflowStepLanguage = 'bash' | 'node' | 'python' | 'ruby';

// Custom workflow definition (user-authored)
export interface CustomWorkflowStep {
  name: string;
  run: string;                // shell command (or script body when language !== 'bash')
  language?: CustomWorkflowStepLanguage; // interpreter; defaults to 'bash' when absent
  workingDir?: string;        // relative to project root
  env?: Record<string, string>;
  retry?: number;
  timeoutMs?: number;
  // Cache config for this step
  cache?: { key: string; paths: string[]; restore: boolean; save: boolean };
  // Test report config: parse output as test report
  testReport?: { format: 'junit' | 'json' | 'tap'; path: string };
  // Continue on error (don't fail the run)
  continueOnError?: boolean;
}

export interface CustomWorkflow {
  name: string;
  description?: string;
  matrix?: MatrixConfig;
  retry?: number;
  timeoutMs?: number;
  requiresApproval?: boolean;
  secrets?: string[];
  env?: Record<string, string>;
  steps: CustomWorkflowStep[];
  testReport?: { format: 'junit' | 'json' | 'tap'; path: string };
}

// Run events emitted to SSE
export type RunEventType =
  | 'status'
  | 'log'
  | 'artifact'
  | 'done'
  | 'approval-required'
  | 'cache-hit'
  | 'cache-miss'
  | 'cache-saved'
  | 'retry'
  | 'matrix-started'
  | 'matrix-completed';

// Trigger types
export type TriggerType = 'webhook' | 'cron';

// Test report types
export interface TestSuite {
  name: string;
  cases: TestCase[];
  duration?: number;
}

export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  duration?: number;
  message?: string;
  className?: string;
}

export interface ParsedTestReport {
  format: 'junit' | 'json' | 'tap';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration?: number;
  suites: TestSuite[];
}

// Analytics types
export interface RunComparison {
  runA: { id: string; workflow: string; status: string; durationMs: number | null; startedAt: string };
  runB: { id: string; workflow: string; status: string; durationMs: number | null; startedAt: string };
  durationDiff: number | null; // ms, positive = B slower
  statusChanged: boolean;
  logCountA: number;
  logCountB: number;
  addedLogs: number;
  removedLogs: number;
  newErrors: string[]; // error lines in B not in A
  resolvedErrors: string[]; // error lines in A not in B
}

export interface PerformancePoint {
  runId: string;
  startedAt: string;
  durationMs: number | null;
  status: string;
  exitCode: number | null;
}

export interface FailurePattern {
  workflow: string;
  totalRuns: number;
  failedRuns: number;
  failureRate: number;
  lastFailedAt: string | null;
  sampleErrors: string[];
}
