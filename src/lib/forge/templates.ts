// ============================================================
// Forge — unified template registry (type layer + query API)
// ============================================================
// Forge has four kinds of "reusable definitions that can be applied
// to a project":
//
//   • WorkflowTemplate     — a single CI workflow (install, build, …)
//                            implemented in `./workflows.ts`.
//   • PresetTemplate       — a curated multi-workflow sequence
//                            (full-ci, security-check, …) in `./presets.ts`.
//   • MarketplaceTemplate  — a community-contributed {steps, env?}
//                            payload that maps onto custom-workflows,
//                            in `./marketplace.ts`.
//   • ProjectTemplate      — a quick-start project skeleton with
//                            inline files, in `./templates-projects.ts`.
//
// Previously these were four unrelated modules with four unrelated
// TypeScript interfaces, and callers had to know which file to
// import from. `templates.ts` is the ONE public surface that
// unifies them:
//
//   - A single `Template` union type covering all four shapes.
//   - A single `TemplateKind` discriminant.
//   - One query function per shape (`getWorkflow`, `getPreset`,
//     `getMarketplaceTemplate`, `getProjectTemplate`) plus
//     `allWorkflows()`, `allPresets()`, `allMarketplace()`,
//     `allProjectTemplates()` enumeration helpers.
//   - A `templateKind(t)` discriminator for code that wants to
//     switch on shape.
//
// IMPORTANT: this file is the TYPE LAYER + QUERY LAYER only.
// The actual data continues to live in the four data modules —
// `workflows.ts`, `presets.ts`, `marketplace.ts`,
// `templates-projects.ts` — which are re-exported here for
// backwards compatibility. Existing imports from those four files
// keep working unchanged; new code should prefer importing from
// `@/lib/forge/templates`.
// ============================================================

import type { Workflow } from './workflows';
import type { WorkflowPreset } from './presets';
import type { MarketplaceWorkflow } from './marketplace';
import type { ProjectTemplate } from './templates-projects';

import { ALL_WORKFLOWS, getWorkflow, workflowsForKind } from './workflows';
import { WORKFLOW_PRESETS, availablePresets } from './presets';
import { MARKETPLACE_WORKFLOWS } from './marketplace';
import { PROJECT_TEMPLATES } from './templates-projects';

// ---------------------------------------------------------------------------
// Discriminant
// ---------------------------------------------------------------------------

export type TemplateKind = 'workflow' | 'preset' | 'marketplace' | 'project';

// ---------------------------------------------------------------------------
// Unified template types
// ---------------------------------------------------------------------------
//
// These are type aliases to the existing per-kind interfaces. The original
// data files are unchanged — the unified `Template` union simply collects
// them under one umbrella so callers can hold a "list of templates"
// without caring which kind they are.
//
// (The design spec adds a `kind: 'workflow' | 'preset' | …` discriminant
// field on each variant. We deliberately do NOT add it to the data —
// that would force every existing array literal in the four data files
// to be touched. Instead, `templateKind(t)` below discriminates by
// structural shape, which is 100% reliable for these four interfaces.)

/** A reusable CI workflow (`./workflows.ts`). */
export type WorkflowTemplate = Workflow;

/** A curated multi-workflow sequence (`./presets.ts`). */
export type PresetTemplate = WorkflowPreset;

/** A community-contributed workflow template (`./marketplace.ts`). */
export type MarketplaceTemplate = MarketplaceWorkflow;

/** A quick-start project skeleton (`./templates-projects.ts`). */
// (ProjectTemplate is already exported as a type by templates-projects.ts;
//  we re-export it below. No alias needed here.)

/** Any reusable template. */
export type Template = WorkflowTemplate | PresetTemplate | MarketplaceTemplate | ProjectTemplate;

// ---------------------------------------------------------------------------
// Backwards-compat re-exports — existing callers that import
// `ALL_WORKFLOWS` / `WORKFLOW_PRESETS` / `MARKETPLACE_WORKFLOWS` /
// `PROJECT_TEMPLATES` from the four data files keep working; new code
// can also import them from here.
// ---------------------------------------------------------------------------

export {
  ALL_WORKFLOWS,
  getWorkflow,
  workflowsForKind,
  // Re-export the Workflow interface itself so callers can write
  // `import type { Workflow } from '@/lib/forge/templates'`.
  type Workflow,
  type WorkflowStep,
  type WorkflowCacheConfig,
  type WorkflowTestReportConfig,
  type ArtifactSpec,
} from './workflows';

export {
  WORKFLOW_PRESETS,
  availablePresets,
  type WorkflowPreset,
} from './presets';

export {
  MARKETPLACE_WORKFLOWS,
  type MarketplaceCategory,
  type MarketplaceStep,
  type MarketplaceWorkflow,
  // NOTE: `categories` is intentionally NOT re-exported here — it
  // already lives in `./marketplace` (and re-exported via the barrel
  // `./index.ts`). Re-exporting it from `./templates` too would
  // create a duplicate-export name collision.
} from './marketplace';

export {
  PROJECT_TEMPLATES,
  type ProjectTemplate,
} from './templates-projects';

// ---------------------------------------------------------------------------
// Unified query functions
// ---------------------------------------------------------------------------

/** All workflow templates (alias of `ALL_WORKFLOWS`). */
export function allWorkflows(): WorkflowTemplate[] {
  return ALL_WORKFLOWS;
}

/** All preset templates (alias of `WORKFLOW_PRESETS`). */
export function allPresets(): PresetTemplate[] {
  return WORKFLOW_PRESETS;
}

/** All marketplace templates (a defensive copy of `MARKETPLACE_WORKFLOWS`). */
export function allMarketplace(): MarketplaceTemplate[] {
  // The source array is `readonly`, so callers can't mutate it. We return
  // a mutable copy so consumers can safely sort/filter without surprises.
  return [...MARKETPLACE_WORKFLOWS];
}

/** All project templates (alias of `PROJECT_TEMPLATES`). */
export function allProjectTemplates(): ProjectTemplate[] {
  return PROJECT_TEMPLATES;
}

/** Look up a preset by id. */
export function getPreset(id: string): PresetTemplate | undefined {
  return WORKFLOW_PRESETS.find((p) => p.id === id);
}

/** Look up a marketplace template by id. */
export function getMarketplaceTemplate(id: string): MarketplaceTemplate | undefined {
  return MARKETPLACE_WORKFLOWS.find((t) => t.id === id);
}

/** Look up a project template by id. */
export function getProjectTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Discriminator — figure out which `TemplateKind` a `Template` is, based
// on its structural shape. (We avoid adding a `kind` discriminant field
// to the data so the existing arrays don't need touching.)
//
// The four shapes are structurally distinct:
//   • Workflow          — has `key: string`  (unique among the four)
//   • ProjectTemplate   — has `files: Record<…>` (unique)
//   • MarketplaceWorkflow — has `language: string` (unique)
//   • WorkflowPreset    — has `intent: string` (unique)
// ---------------------------------------------------------------------------

export function templateKind(t: Template): TemplateKind {
  if (typeof (t as Workflow).key === 'string') return 'workflow';
  if (typeof (t as ProjectTemplate).files === 'object') return 'project';
  if (typeof (t as MarketplaceWorkflow).language === 'string') return 'marketplace';
  if (typeof (t as WorkflowPreset).intent === 'string') return 'preset';
  // Should be unreachable for valid Template values.
  throw new Error(`Unknown template shape: ${JSON.stringify(t).slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Convenience: a single array containing every template of every kind.
// Useful for "browse everything" UIs. Each entry is paired with its
// `TemplateKind` so consumers can render accordingly.
// ---------------------------------------------------------------------------

export interface CataloguedTemplate {
  kind: TemplateKind;
  template: Template;
}

export function allTemplates(): CataloguedTemplate[] {
  return [
    ...ALL_WORKFLOWS.map((t) => ({ kind: 'workflow' as const, template: t as Template })),
    ...WORKFLOW_PRESETS.map((t) => ({ kind: 'preset' as const, template: t as Template })),
    ...MARKETPLACE_WORKFLOWS.map((t) => ({ kind: 'marketplace' as const, template: t as Template })),
    ...PROJECT_TEMPLATES.map((t) => ({ kind: 'project' as const, template: t as Template })),
  ];
}
