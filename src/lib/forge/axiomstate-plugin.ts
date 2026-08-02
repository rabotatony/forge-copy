// ============================================================
// Forge — AxiomState workflow plugin (parse / bundle)
// ============================================================
// Registers `WorkflowPlugin` entries for the `parse` and `bundle`
// workflow keys declared in `workflows.ts`. The implementation is
// lifted verbatim from the old `engine.ts:runAxiomWorkflow` helper
// (lines 780-911 in the pre-R-1 codebase).
//
// Why a plugin?
// -------------
// These two workflows don't execute shell commands — they call into
// the AxiomState parser/writer/bundler directly. Previously
// `workflows.ts` declared them with fake `echo` shell steps and
// `engine.ts` had a hardcoded `if (workflow === 'parse' || workflow
// === 'bundle')` branch that bypassed the steps. The catalog and
// the engine disagreed about who owned the workflows.
//
// With the plugin registry (`./workflow-plugins.ts`), the engine
// checks `getWorkflowPlugin(key)` FIRST and dispatches to whatever
// plugin is registered — no hardcoded branch. Adding a new
// non-shell workflow is now a one-file change.
//
// Module-load side effect
// -----------------------
// Importing this module registers two plugins (`parse`, `bundle`)
// with the global plugin registry. The engine imports this module
// for its side effects (`import './axiomstate-plugin'`); callers
// don't import it directly.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

import { db } from '@/lib/db';
import { extractDir, runArtifactDir } from './storage';
import { registerWorkflowPlugin, type WorkflowPlugin } from './workflow-plugins';
import type { MatrixRow } from './types';

// ---------------------------------------------------------------------------
// Shared AxiomState runner — parses the project, then either logs every
// node (parse) or produces a topologically-ordered bundle (bundle).
// ---------------------------------------------------------------------------

async function runAxiomWorkflow(
  runId: string,
  projectRoot: string,
  key: 'parse' | 'bundle',
  matrixValues?: MatrixRow,
): Promise<number> {
  // Lazy-import engine internals to avoid a static circular dependency:
  // engine.ts imports this module (for its registration side-effect),
  // and this module needs engine's appendLog + emit at runtime.
  const { appendLog, emit } = await import('./engine');

  try {
    const { parseProject, writeGraph, sliceForward } = await import(
      '@/lib/axiomstate/phase1'
    );
    const { bundleFiles } = await import('@/lib/axiomstate/phase2');
    const { LSSKernel } = await import('@/lib/axiomstate/phase0/kernel');

    // Place the kernel under the project's own storage directory (not
    // under an unrelated project's path — preserves the post-bug-fix
    // behavior from engine.ts). The fake "__axiomstate__" project id
    // namespaces these per-run kernel dirs so they don't collide with
    // real extracted projects.
    const kernelDir = path.join(
      path.dirname(extractDir('__axiomstate__')),
      `kernel-${runId}`,
    );
    fs.mkdirSync(kernelDir, { recursive: true });
    const kernel = new LSSKernel(kernelDir);

    await appendLog(
      runId,
      'system',
      `AxiomState: parsing project at ${projectRoot}`,
    );
    const delta = parseProject(projectRoot);
    const seq = writeGraph(kernel, delta, {
      checkpoint: false,
      providerName: 'typescript+regex',
    });
    await appendLog(
      runId,
      'stdout',
      `Parsed ${delta.nodes.length} nodes and ${delta.edges.length} edges (seq=${seq}).`,
    );
    if (matrixValues) {
      await appendLog(runId, 'system', `Matrix: ${JSON.stringify(matrixValues)}`);
    }

    if (key === 'parse') {
      for (const node of delta.nodes) {
        await appendLog(
          runId,
          'stdout',
          `  ${node.kind.padEnd(6)} ${node.id}  (deps: ${node.deps.length})`,
        );
      }
    } else {
      const indexNode = delta.nodes.find(
        (n) => n.kind === 'file' && /index\.(ts|js|tsx|jsx)$/.test(n.name),
      );
      if (!indexNode) {
        await appendLog(
          runId,
          'stderr',
          'No index.(ts|js|tsx|jsx) entry found — cannot bundle.',
        );
        return 1;
      }
      await appendLog(
        runId,
        'system',
        `AxiomState: bundling forward slice from ${indexNode.id}`,
      );
      const slice = sliceForward(kernel, indexNode.id);
      const fileIds = Array.from(slice.nodes.values())
        .filter((n) => n.kind === 'file')
        .map((n) => n.id);
      const bundle = bundleFiles(kernel, fileIds);
      await appendLog(
        runId,
        'stdout',
        `Bundle order (${bundle.order.length} files):`,
      );
      for (const id of bundle.order) await appendLog(runId, 'stdout', `  • ${id}`);
      if (bundle.cycles.length > 0) {
        await appendLog(
          runId,
          'stderr',
          `Cycles detected: ${bundle.cycles.length}`,
        );
        for (const cycle of bundle.cycles)
          await appendLog(runId, 'stderr', `  ↻ ${cycle.join(' → ')}`);
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
        data: {
          runId,
          name: 'bundle.js',
          path: outPath,
          size: stat.size,
          mime: 'text/javascript',
        },
      });
      emit({
        type: 'artifact',
        runId,
        artifact: { id: artifact.id, name: artifact.name, size: artifact.size },
      });
      await appendLog(
        runId,
        'system',
        `Artifact written: bundle.js (${stat.size} bytes)`,
      );
    }

    kernel.close();
    try {
      fs.rmSync(kernelDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return 0;
  } catch (err) {
    await appendLog(
      runId,
      'stderr',
      `AxiomState error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Plugin registrations — module-load side effect.
// ---------------------------------------------------------------------------

const parsePlugin: WorkflowPlugin = {
  key: 'parse',
  execute: (runId, projectRoot, matrixValues) =>
    runAxiomWorkflow(runId, projectRoot, 'parse', matrixValues),
};

const bundlePlugin: WorkflowPlugin = {
  key: 'bundle',
  execute: (runId, projectRoot, matrixValues) =>
    runAxiomWorkflow(runId, projectRoot, 'bundle', matrixValues),
};

registerWorkflowPlugin(parsePlugin);
registerWorkflowPlugin(bundlePlugin);
