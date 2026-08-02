// ============================================================
// Forge — workflow categories
// ============================================================
// Groups all 33 workflows into logical categories so the UI can
// present them as a structured catalog instead of a flat list.
// ============================================================

export interface WorkflowCategory {
  id: string;
  label: string;
  emoji: string;
  description: string;
  // Workflow keys that belong to this category.
  workflows: string[];
}

export const WORKFLOW_CATEGORIES: WorkflowCategory[] = [
  {
    id: 'build',
    label: 'Build & Package',
    emoji: '📦',
    description: 'Compile, bundle, and package your project',
    workflows: ['install', 'build', 'bundle', 'bundle-size', 'build-apk', 'docker-build', 'docker-push'],
  },
  {
    id: 'test',
    label: 'Test & Quality',
    emoji: '🧪',
    description: 'Run tests, measure coverage, check code quality',
    workflows: ['test', 'coverage', 'lint', 'format-check'],
  },
  {
    id: 'security',
    label: 'Security',
    emoji: '🔒',
    description: 'Audit dependencies and scan for vulnerabilities',
    workflows: ['npm-audit', 'security-scan', 'pip-audit', 'cargo-audit', 'license-check', 'npm-outdated'],
  },
  {
    id: 'deploy',
    label: 'Deploy & Release',
    emoji: '🚀',
    description: 'Ship to production and manage releases',
    workflows: ['deploy-ssh', 'deploy-rsync', 'release', 'db-migrate'],
  },
  {
    id: 'inspect',
    label: 'Inspect & Analyze',
    emoji: '🔍',
    description: 'Parse project structure and dependencies',
    workflows: ['inspect', 'parse'],
  },
  {
    id: 'rust',
    label: 'Rust',
    emoji: '🦀',
    description: 'Cargo build, test, clippy, and audit',
    workflows: ['cargo-build', 'cargo-test', 'cargo-clippy'],
  },
  {
    id: 'go',
    label: 'Go',
    emoji: '🐹',
    description: 'Go build, test, vet, and coverage',
    workflows: ['go-build', 'go-test', 'go-vet', 'go-coverage'],
  },
  {
    id: 'python',
    label: 'Python',
    emoji: '🐍',
    description: 'pip install, pytest, and coverage',
    workflows: ['pip-install', 'pytest', 'py-coverage'],
  },
];

/**
 * Look up which category a workflow key belongs to.
 * Returns 'inspect' as a fallback for uncategorized workflows.
 */
export function categoryForWorkflow(key: string): string {
  for (const cat of WORKFLOW_CATEGORIES) {
    if (cat.workflows.includes(key)) return cat.id;
  }
  return 'inspect';
}

/**
 * Get all unique workflow keys across all categories.
 */
export function allCategorizedWorkflows(): string[] {
  const set = new Set<string>();
  for (const cat of WORKFLOW_CATEGORIES) {
    for (const w of cat.workflows) set.add(w);
  }
  return Array.from(set);
}
