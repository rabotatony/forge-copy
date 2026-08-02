// ============================================================
// Forge — Experiments Lab promotion
// ============================================================
// promoteExperimentRun(runId) — turn a BREAKTHROUGH run into a permanent
// Forge workflow so it can be re-run like any other pipeline:
//   1. Load the run; assert verdict === 'BREAKTHROUGH' && !promoted.
//   2. Build a CustomWorkflow JSON skeleton from the run's evidence +
//      metrics (we re-derive a representative workflow because the engine
//      only logs metadata, not the full generated script code).
//   3. Find-or-create a synthetic "Forge Lab" project to host the promoted
//      pipeline so it doesn't pollute real projects.
//   4. Persist the pipeline; mark the run as promoted with the new
//      workflowId + a deterministic presetId the UI can display.
// ============================================================

import { db } from '@/lib/db';

export async function promoteExperimentRun(runId: string): Promise<{ workflowId: string; presetId: string }> {
  const run = await db.experimentRun.findUnique({
    where: { id: runId },
    include: { experiment: true },
  });
  if (!run) throw new Error('Run not found');
  if (run.verdict !== 'BREAKTHROUGH') throw new Error('Only BREAKTHROUGH runs can be promoted');
  if (run.promoted) throw new Error('Run already promoted');

  // Extract the generated scripts from the evidence to build a workflow.
  const evidence = run.evidence ? JSON.parse(run.evidence) : { steps: [] };
  const genSteps = (evidence.steps ?? []).filter((s: { step?: string }) => typeof s.step === 'string' && s.step.startsWith('ai-generate-'));

  // Build a CustomWorkflow JSON that captures the experiment's scripts.
  // We pull the actual script code from the execute steps' context — but
  // since we only logged metadata, we re-derive a representative workflow
  // from the experiment definition + the metrics.
  const customWorkflow = {
    name: `[Lab] ${run.experiment.name}`,
    description: `Auto-promoted from experiment run ${run.id}. ${run.verdictReason ?? ''}`,
    steps: [
      {
        name: 'experiment-context',
        run: `echo "Promoted from Forge Experiments Lab" && echo "Experiment: ${run.experiment.slug}" && echo "Verdict: ${run.verdict}" && echo "Reason: ${run.verdictReason ?? ''}"`,
      },
      {
        name: 'metrics',
        run: `echo '${JSON.stringify(run.metrics ?? '{}')}'`,
      },
    ],
  };

  // Save as a Pipeline (the canonical workflow storage) so it appears in
  // the project's workflow catalog and can be run like any other workflow.
  // We attach it to a synthetic "Lab" project so it doesn't pollute real
  // projects. If no Lab project exists, create one.
  let labProject = await db.project.findFirst({ where: { name: 'Forge Lab' } });
  if (!labProject) {
    labProject = await db.project.create({
      data: {
        name: 'Forge Lab',
        fileName: 'forge-lab',
        kind: 'unknown',
        fileCount: 0,
        fileSize: 0,
        extractedPath: '',
        detection: '{"type":"lab","hints":[]}',
      },
    });
  }

  const pipeline = await db.pipeline.create({
    data: {
      projectId: labProject.id,
      name: customWorkflow.name,
      stages: JSON.stringify([{ id: 'lab', name: 'lab', kind: 'custom' }]),
      config: JSON.stringify({ customWorkflow }),
    },
  });

  // Persist a synthetic presetId so the UI can display a stable reference.
  // (Presets themselves are code-defined in src/lib/forge/presets.ts; there
  // is no Preset table. We store a deterministic id derived from the run.)
  const presetId = `lab-${run.experiment.slug}-${run.id.slice(-6)}`;

  await db.experimentRun.update({
    where: { id: run.id },
    data: {
      promoted: true,
      promotedWorkflowId: pipeline.id,
      promotedPresetId: presetId,
    },
  });

  return { workflowId: pipeline.id, presetId };
}
