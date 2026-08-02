// ============================================================
// Forge — workflow preset templates
// ============================================================
// Quick-start presets that combine multiple workflows into a single
// one-click action. Like GitHub Actions "starter workflows" but
// smarter — each preset is a curated sequence tuned for a goal.
// ============================================================

export interface WorkflowPreset {
  id: string;
  name: string;
  emoji: string;
  description: string;
  // Ordered workflow keys to run.
  steps: string[];
  // Which intent this preset addresses.
  intent: string;
  // Estimated time in seconds (for UI display).
  estimatedSeconds: number;
  // Whether this preset requires approval (e.g. production deploy).
  requiresApproval?: boolean;
  // Category badge for filtering.
  category: 'build' | 'test' | 'security' | 'deploy' | 'release';
}

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'ship-apk',
    name: 'Ship Android APK',
    emoji: '📱',
    description: 'Wrap HTML/JS into a signed, installable Android APK',
    steps: ['build-apk'],
    intent: 'apk',
    estimatedSeconds: 60,
    category: 'build',
  },
  {
    id: 'full-ci',
    name: 'Full CI',
    emoji: '🔄',
    description: 'Install → Build → Test → Lint — the complete quality gate',
    steps: ['install', 'build', 'test', 'lint'],
    intent: 'web-app',
    estimatedSeconds: 120,
    category: 'test',
  },
  {
    id: 'security-check',
    name: 'Security Audit',
    emoji: '🔒',
    description: 'Audit dependencies + scan source for vulnerabilities',
    steps: ['npm-audit', 'security-scan'],
    intent: 'security-audit',
    estimatedSeconds: 45,
    category: 'security',
  },
  {
    id: 'release-prep',
    name: 'Prepare Release',
    emoji: '📦',
    description: 'Build + bump version + bundle release archive',
    steps: ['install', 'build', 'release'],
    intent: 'release-bundle',
    estimatedSeconds: 90,
    category: 'release',
  },
  {
    id: 'docker-ship',
    name: 'Build & Push Docker',
    emoji: '🐳',
    description: 'Build a Docker image and push to registry',
    steps: ['docker-build', 'docker-push'],
    intent: 'docker-image',
    estimatedSeconds: 180,
    category: 'deploy',
    requiresApproval: true,
  },
  {
    id: 'inspect-deep',
    name: 'Deep Inspect',
    emoji: '🔍',
    description: 'Inspect + parse AST + bundle analysis',
    steps: ['inspect', 'parse', 'bundle'],
    intent: 'source-inspect',
    estimatedSeconds: 30,
    category: 'build',
  },
  {
    id: 'test-coverage',
    name: 'Test + Coverage',
    emoji: '🧪',
    description: 'Run tests and generate a coverage report',
    steps: ['install', 'test', 'coverage'],
    intent: 'test-suite',
    estimatedSeconds: 60,
    category: 'test',
  },
  {
    id: 'quality-gate',
    name: 'Quality Gate',
    emoji: '✅',
    description: 'Lint + format check + license check — must pass before merge',
    steps: ['install', 'lint', 'format-check', 'license-check'],
    intent: 'web-app',
    estimatedSeconds: 45,
    category: 'test',
  },
];

/**
 * Filter presets to only those whose steps are ALL available
 * for the given project's workflow keys.
 */
export function availablePresets(availableWorkflowKeys: string[]): WorkflowPreset[] {
  const set = new Set(availableWorkflowKeys);
  return WORKFLOW_PRESETS.filter(p => p.steps.every(s => set.has(s)));
}
