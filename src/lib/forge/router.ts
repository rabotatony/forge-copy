// ============================================================
// Forge — smart workflow router
// ============================================================
// Takes the intent detection result + the project's applicable
// workflows and produces a ranked recommendation list, including:
//   • "primary" — the single best workflow to run first
//   • "recommended" — a handful of high-value workflows
//   • "autoRun" — an ordered sequence that achieves the intent
//   • "applies" — which workflow keys are actually available
//
// This is the bridge between "what does the user want?" (intelligence.ts)
// and "which workflows can we run?" (workflows.ts).
// ============================================================

import { ALL_WORKFLOWS, workflowsForKind, type Workflow } from './workflows';
import type { Detection, ProjectKind } from './detector';
import type { Intent, IntentResult } from './intelligence';

export interface RouterRecommendation {
  /** The detected intent. */
  intent: Intent;
  /** Human-readable intent label. */
  intentLabel: string;
  /** All detected intent signals (sorted by confidence). */
  signals: IntentResult['signals'];
  /** Summary string from intelligence. */
  summary: string;
  /** The single best workflow to run first. */
  primary: string | null;
  /** 3-6 recommended workflow keys, ranked. */
  recommended: string[];
  /** Ordered sequence to fully achieve the intent (skips unavailable). */
  autoRun: string[];
  /** All workflow keys available for this project. */
  available: string[];
  /** Whether the primary recommended workflow exists in the catalog. */
  primaryAvailable: boolean;
  /** Reasons for each recommendation (key → reason). */
  reasons: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Intent → preferred workflow keys (in priority order)
// ---------------------------------------------------------------------------

const INTENT_WORKFLOW_PRIORITY: Record<Intent, string[]> = {
  apk: ['build-apk', 'inspect'],
  'web-app': ['build', 'install', 'bundle-size', 'lint', 'test'],
  'static-site': ['inspect', 'bundle'],
  'cli-binary': ['build', 'inspect'],
  'desktop-app': ['build', 'install'],
  'docker-image': ['docker-build', 'inspect'],
  library: ['build', 'test', 'lint', 'install'],
  'api-server': ['build', 'test', 'install'],
  'ios-app': [],
  'desktop-installer': ['build', 'install'],
  'test-suite': ['test', 'coverage', 'install'],
  'security-audit': ['npm-audit', 'security-scan', 'install'],
  'release-bundle': ['release-patch', 'build', 'install'],
  'source-inspect': ['inspect', 'parse', 'bundle'],
  unknown: ['inspect'],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recommend(
  intentResult: IntentResult,
  kind: ProjectKind,
  detection: Detection,
  projectRoot: string,
): RouterRecommendation {
  // Get the full list of applicable workflows for this project.
  const applicable = workflowsForKind(kind, detection, projectRoot);
  const availableKeys = new Set(applicable.map(w => w.key));
  const workflowMap = new Map(applicable.map(w => [w.key, w] as const));

  const intent = intentResult.primary;
  const priority = INTENT_WORKFLOW_PRIORITY[intent] ?? ['inspect'];

  // Primary = first priority workflow that's actually available.
  let primary: string | null = null;
  for (const key of priority) {
    if (availableKeys.has(key)) { primary = key; break; }
  }
  // Fallback: if none of the priority workflows are available, use inspect.
  if (!primary && availableKeys.has('inspect')) primary = 'inspect';

  // Recommended = priority workflows that are available, top 6.
  const recommended: string[] = [];
  for (const key of priority) {
    if (availableKeys.has(key) && !recommended.includes(key)) recommended.push(key);
    if (recommended.length >= 6) break;
  }
  // Always include inspect at the end if available and not already there.
  if (availableKeys.has('inspect') && !recommended.includes('inspect')) {
    recommended.push('inspect');
  }

  // Auto-run = the intent's suggested sequence, filtered to available.
  const autoRun = intentResult.suggestedAutoRun.filter(k => availableKeys.has(k));

  // Build human-readable reasons.
  const reasons = buildReasons(intent, recommended, workflowMap, intentResult);

  return {
    intent,
    intentLabel: intentResult.signals[0]?.reason ?? 'Analyze project',
    signals: intentResult.signals,
    summary: intentResult.summary,
    primary,
    recommended,
    autoRun,
    available: Array.from(availableKeys),
    primaryAvailable: primary !== null,
    reasons,
  };
}

function buildReasons(
  intent: Intent,
  recommended: string[],
  workflowMap: Map<string, Workflow>,
  intentResult: IntentResult,
): Record<string, string> {
  const reasons: Record<string, string> = {};
  const topSignal = intentResult.signals[0];

  for (const key of recommended) {
    const wf = workflowMap.get(key);
    if (!wf) continue;

    // Intent-specific reasoning.
    switch (intent) {
      case 'apk':
        if (key === 'build-apk') reasons[key] = 'Wrap your HTML/JS into a signed Android APK — this is what you uploaded for.';
        else if (key === 'inspect') reasons[key] = 'Inspect the project structure before building.';
        else reasons[key] = wf.description;
        break;
      case 'web-app':
        if (key === 'install') reasons[key] = 'Install dependencies first so subsequent steps can build.';
        else if (key === 'build') reasons[key] = 'Build the production web bundle.';
        else if (key === 'bundle-size') reasons[key] = 'Measure the output bundle size.';
        else if (key === 'lint') reasons[key] = 'Catch code-quality issues.';
        else if (key === 'test') reasons[key] = 'Run the test suite.';
        else reasons[key] = wf.description;
        break;
      case 'test-suite':
        if (key === 'test') reasons[key] = 'Run all tests — your primary goal.';
        else if (key === 'coverage') reasons[key] = 'Generate a coverage report.';
        else reasons[key] = wf.description;
        break;
      case 'security-audit':
        if (key === 'npm-audit') reasons[key] = 'Audit npm dependencies for known CVEs.';
        else if (key === 'security-scan') reasons[key] = 'Scan source for security issues.';
        else reasons[key] = wf.description;
        break;
      case 'docker-image':
        if (key === 'docker-build') reasons[key] = 'Build the Docker image from your Dockerfile.';
        else reasons[key] = wf.description;
        break;
      case 'cli-binary':
        if (key === 'build') reasons[key] = 'Compile the release binary.';
        else reasons[key] = wf.description;
        break;
      case 'library':
        if (key === 'build') reasons[key] = 'Build the library for publishing.';
        else if (key === 'test') reasons[key] = 'Run tests before publishing.';
        else if (key === 'lint') reasons[key] = 'Ensure code quality before publishing.';
        else reasons[key] = wf.description;
        break;
      default:
        reasons[key] = wf.description;
    }
  }

  // Fallback reason using the top signal.
  if (Object.keys(reasons).length === 0 && topSignal) {
    reasons['inspect'] = topSignal.reason;
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Convenience: does a workflow key exist in the catalog at all?
// (Used by the API layer to check intent-suggested workflows that
// might not be registered, e.g. 'build-apk'.)
// ---------------------------------------------------------------------------

export function workflowExists(key: string): boolean {
  return ALL_WORKFLOWS.some(w => w.key === key);
}
