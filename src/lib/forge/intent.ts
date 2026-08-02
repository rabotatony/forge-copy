// ============================================================
// Forge — unified intent pipeline
// ============================================================
// The "what does this project want?" pipeline has three stages,
// previously spread across three separate modules that callers had
// to know about and import individually:
//
//   detectProject (./detector.ts)
//       └─→ "what kind of project is this?" (node / python / rust / …)
//
//   detectIntent  (./intelligence.ts)
//       └─→ "what does the user want to produce?" (apk, web-app, …)
//
//   recommend     (./router.ts)
//       └─→ "which workflows should we suggest?" (priority + autoRun)
//
// `intent.ts` is the ONE public surface for the entire pipeline:
//
//   - Re-exports every symbol a caller might need from the three
//     implementation modules (so existing imports from
//     `@/lib/forge/detector` / `intelligence` / `router` keep working
//     AND new code can import everything from `@/lib/forge/intent`).
//
//   - Adds a convenience `analyzeProject(rootDir)` that runs all
//     three stages in sequence and returns a single object:
//         { detection, intent, recommendation }
//
// The implementation files stay where they are — `intent.ts` is the
// unified PUBLIC INTERFACE, not a rewrite.
// ============================================================

// ---------------------------------------------------------------------------
// Stage 1: detection — what kind of project is this?
// ---------------------------------------------------------------------------

export {
  detectProject,
} from './detector';

export type {
  ProjectKind,
  NodeDetection,
  PythonDetection,
  RustDetection,
  GoDetection,
  UnknownDetection,
  Detection,
  DetectionResult,
} from './detector';

// ---------------------------------------------------------------------------
// Stage 2: intent — what does the user want to produce?
// ---------------------------------------------------------------------------

export {
  detectIntent,
  autoRunForIntent,
  workflowsForIntent,
  INTENT_LABELS,
} from './intelligence';

export type {
  Intent,
  IntentSignal,
  IntentResult,
} from './intelligence';

// ---------------------------------------------------------------------------
// Stage 3: recommendation — which workflows should we suggest?
// ---------------------------------------------------------------------------

export {
  recommend,
  workflowExists,
} from './router';

export type {
  RouterRecommendation,
} from './router';

// ---------------------------------------------------------------------------
// Convenience: run all three stages in one call.
// ---------------------------------------------------------------------------

import { detectProject } from './detector';
import { detectIntent } from './intelligence';
import { recommend } from './router';

export interface ProjectAnalysis {
  /** Stage 1: what kind of project this is. */
  detection: ReturnType<typeof detectProject>;
  /** Stage 2: what the user likely wants to produce. */
  intent: ReturnType<typeof detectIntent>;
  /** Stage 3: which workflows to suggest / auto-run. */
  recommendation: ReturnType<typeof recommend>;
}

/**
 * Run the full detect → infer → recommend pipeline against a project
 * root directory.
 *
 * Equivalent to:
 *
 *   const detection     = detectProject(rootDir);
 *   const intent        = detectIntent(rootDir, detection.detection, detection.kind);
 *   const recommendation = recommend(intent, detection.kind, detection.detection, rootDir);
 *
 * Returns all three results in a single object so callers don't need
 * to wire the stages together themselves.
 */
export function analyzeProject(rootDir: string): ProjectAnalysis {
  const detection = detectProject(rootDir);
  const intent = detectIntent(
    rootDir,
    detection.detection,
    detection.kind,
  );
  const recommendation = recommend(
    intent,
    detection.kind,
    detection.detection,
    rootDir,
  );
  return { detection, intent, recommendation };
}
