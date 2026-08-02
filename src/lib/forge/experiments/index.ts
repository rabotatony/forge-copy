// ============================================================
// Forge — Experiments Lab barrel
// ============================================================
// Re-exports every public symbol of the experiments subsystem so callers
// can import from '@/lib/forge/experiments' (this barrel) or
// '@/lib/forge/experiments/engine' (the legacy path, which is itself a
// thin re-export barrel over this file). Both paths expose the same
// public API as the pre-split monolithic engine.ts.
//
// Public API (everything that was exported from the old engine.ts):
//   - Types:        ExperimentCategory, Verdict, RunStatus,
//                   ExperimentDefinition, RunContext, GeneratedScript,
//                   ExecOpts, ExecResult, RunResult
//   - Registry:     EXPERIMENTS
//   - Orchestration: runExperiment, listExperimentsWithLatestRun, listRuns
//   - Promotion:    promoteExperimentRun
//
// Additionally re-exports the new internal helper surfaces (extractJson,
// generateScript, median, measureComplexity, measureMaxNesting) so they
// are reachable from the barrel for tests and future experiments.
// ============================================================

export * from './types';
export * from './definitions';
export * from './llm';
export * from './verdict';
export * from './runner';
export * from './promote';
