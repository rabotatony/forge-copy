// ============================================================
// Forge — workflow plugin registry
// ============================================================
// Most workflows in `workflows.ts` produce shell steps that the engine
// runs via the shared `runChildStep` primitive. A handful of workflows
// don't — they're implemented in TypeScript and want direct access to
// the engine's logging / artifact / event APIs. Examples:
//
//   • `parse`   — runs the AxiomState parser over `src/` and logs
//                 every node / edge in the dependency graph.
//   • `bundle`  — produces a topologically-ordered single-file bundle
//                 using AxiomState's forward-slice + bundle phases,
//                 writes `bundle.js` as an artifact.
//
// Historically these were "fake shell workflows" — `workflows.ts`
// returned `echo "AxiomState parse — handled by runner.ts (no shell
// command)"` and `engine.ts` had a hardcoded `if (workflow === 'parse'
// || workflow === 'bundle')` branch that called `runAxiomWorkflow`
// instead of running the (echo) steps. The catalog and the engine
// disagreed about who owned these workflows, and the comment in the
// echo command lied (`runner.ts` doesn't exist).
//
// The plugin registry fixes this:
//
//   • `workflows.ts` declares a workflow with `plugin: true` and an
//     empty `build: () => []`. The catalog still owns the metadata
//     (name, description, icon, kinds, applies predicate) — but
//     admits it doesn't own the execution.
//
//   • The plugin implementation (e.g. `axiomstate-plugin.ts`) calls
//     `registerWorkflowPlugin({ key, execute })` at module load.
//
//   • The engine checks `getWorkflowPlugin(workflowKey)` FIRST. If a
//     plugin is registered, the engine dispatches to it and skips
//     the shell-step loop entirely. No more hardcoded `parse` /
//     `bundle` branch.
//
// Adding a new non-shell workflow is now a one-file change: write a
// plugin, register it, declare the workflow in the catalog with
// `plugin: true`. No engine edits required.
// ============================================================

import type { MatrixRow } from './types';

// ---------------------------------------------------------------------------
// Plugin contract
// ---------------------------------------------------------------------------

export interface WorkflowPlugin {
  /** Workflow key — must match a `Workflow.key` in the catalog. */
  key: string;
  /**
   * Execute the workflow. Returns the final exit code (0 = success).
   *
   * The plugin is responsible for its own logging (via
   * `appendLog` from `./engine` — lazily imported to avoid a
   * circular dependency) and artifact capture (via
   * `db.artifact.create` directly).
   *
   * @param runId         The run id (for log lines, events, artifacts).
   * @param projectRoot   The extracted project root directory.
   * @param matrixValues  Optional matrix row for fan-out runs.
   */
  execute: (
    runId: string,
    projectRoot: string,
    matrixValues?: MatrixRow,
  ) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const plugins = new Map<string, WorkflowPlugin>();

/**
 * Register a workflow plugin. If a plugin is already registered for
 * the same key, the new one replaces it. Called at module load by
 * plugin implementations (e.g. `axiomstate-plugin.ts`).
 */
export function registerWorkflowPlugin(plugin: WorkflowPlugin): void {
  if (!plugin.key) {
    throw new Error('WorkflowPlugin.key must be non-empty');
  }
  if (typeof plugin.execute !== 'function') {
    throw new Error(`WorkflowPlugin "${plugin.key}" has no execute() function`);
  }
  plugins.set(plugin.key, plugin);
}

/** Look up the plugin registered for `key`, if any. */
export function getWorkflowPlugin(key: string): WorkflowPlugin | undefined {
  return plugins.get(key);
}

/** Returns `true` if any plugin is registered for `key`. */
export function hasWorkflowPlugin(key: string): boolean {
  return plugins.has(key);
}

/** All registered plugin keys (useful for debugging / UI display). */
export function registeredPluginKeys(): string[] {
  return Array.from(plugins.keys());
}

/** Remove a plugin from the registry (primarily for tests). */
export function unregisterWorkflowPlugin(key: string): boolean {
  return plugins.delete(key);
}
