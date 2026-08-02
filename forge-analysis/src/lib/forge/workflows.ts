// ============================================================
// Forge — workflow catalog
// ============================================================
// Workflows are predefined CI jobs (like GitHub Actions workflows).
// Each workflow knows how to build its command list for a given
// project root and detection.
//
// Phase 2 extensions:
//   • Optional `secrets`, `cache`, `testReport`, `requiresApproval`,
//     `defaultRetry`, `defaultTimeoutMs` fields per workflow — these
//     are read by the API layer and passed into `startRunExtended`.
//   • Optional `applies(detection, projectRoot)` predicate for
//     file-existence checks (e.g. Dockerfile) that `build(detection)`
//     alone can't perform.
//   • `WorkflowStep` extended with `env`, `retry`, `timeoutMs`,
//     `workingDir` for per-step overrides.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Detection, ProjectKind } from './detector';

export interface WorkflowStep {
  // Human-readable label shown in the UI.
  label: string;
  // Shell command (run with `bash -c` on unix, or via child_process spawn).
  command: string;
  // Working directory (always the project root, but kept for flexibility).
  cwd?: 'project';
  // Optional: which stream to mark the output (default: auto from process).
  stream?: 'stdout' | 'stderr' | 'system';
  // Optional: extra env vars for this step only (merged on top of run env).
  env?: Record<string, string>;
  // Optional: per-step retry count (overrides the run-level retry).
  retry?: number;
  // Optional: per-step timeout in ms (overrides the run-level timeout).
  timeoutMs?: number;
  // Optional: working directory relative to project root.
  workingDir?: string;
}

export interface WorkflowCacheConfig {
  label: string;
  // Paths (relative to project root) to save/restore.
  paths: string[];
  // Built-in cache-key generator to use.
  keyGenerator: 'node' | 'cargo' | 'go' | 'python' | 'none';
}

export interface WorkflowTestReportConfig {
  format: 'junit' | 'json' | 'tap';
  // Path (relative to project root) of the test report file produced.
  path: string;
}

export interface Workflow {
  key: string;
  name: string;
  description: string;
  // Icon name from lucide-react.
  icon: string;
  // Which project kinds this workflow supports.
  kinds: ProjectKind[];
  // Builder returns a list of steps; or null if the workflow doesn't
  // apply to this detection (e.g. no `build` script in package.json).
  build: (detection: Detection) => WorkflowStep[] | null;
  // Whether to capture artifacts after the run.
  producesArtifacts?: (detection: Detection, projectRoot: string) => ArtifactSpec[];

  // --- Phase 2 optional fields ---
  // File-existence / applicability predicate. If present and returns
  // false, the workflow is excluded from `workflowsForKind` results.
  // Use this for things `build(detection)` can't check on its own
  // (e.g. Dockerfile presence).
  applies?: (detection: Detection, projectRoot: string) => boolean;
  // Secret keys to inject as env vars when running this workflow.
  secrets?: string[];
  // Cache configuration (the caller computes the actual cache key via
  // the corresponding `*CacheKey` helper from `./cache`).
  cache?: WorkflowCacheConfig;
  // Test report capture: if set, the runner parses the file at `path`
  // after the run and stores a TestReport row.
  testReport?: WorkflowTestReportConfig;
  // Whether this workflow requires manual approval before running.
  requiresApproval?: boolean;
  // Default per-step retry count for this workflow.
  defaultRetry?: number;
  // Default per-run timeout in ms for this workflow.
  defaultTimeoutMs?: number;
}

export interface ArtifactSpec {
  // Logical name shown in the UI.
  name: string;
  // Glob pattern relative to projectRoot.
  glob: string;
  mime: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileExists(projectRoot: string, file: string): boolean {
  try {
    return fs.existsSync(path.join(projectRoot, file));
  } catch {
    return false;
  }
}

function hasNodeScript(detection: Detection, name: string): boolean {
  return detection.type === 'node' && !!detection.scripts?.[name];
}

function projectName(detection: Detection): string {
  if (detection.type === 'node' && detection.packageName) {
    // Strip scope (e.g. @forge/app -> app) for docker tag use.
    return detection.packageName.replace(/^@[^/]+\//, '');
  }
  if (detection.type === 'rust' && detection.crateName) return detection.crateName;
  if (detection.type === 'go' && detection.moduleName) {
    return detection.moduleName.split('/').pop() ?? 'app';
  }
  if (detection.type === 'python' && detection.projectName) return detection.projectName;
  return 'app';
}

const ALL_KINDS: ProjectKind[] = ['node', 'python', 'rust', 'go', 'unknown'];

// ---------------------------------------------------------------------------
// Node.js workflows
// ---------------------------------------------------------------------------

const nodeWorkflows: Workflow[] = [
  {
    key: 'install',
    name: 'Install dependencies',
    description: 'Run `npm install` (or `pnpm install` / `yarn`) to populate node_modules.',
    icon: 'Package',
    kinds: ['node'],
    cache: {
      label: 'node_modules',
      paths: ['node_modules'],
      keyGenerator: 'node',
    },
    build: () => [
      { label: 'Detect package manager', command: 'if [ -f pnpm-lock.yaml ]; then echo pnpm; elif [ -f yarn.lock ]; then echo yarn; elif [ -f bun.lockb ]; then echo bun; else echo npm; fi' },
      { label: 'npm install', command: 'npm install --no-audit --no-fund' },
    ],
  },
  {
    key: 'build',
    name: 'Build',
    description: 'Run the project\'s build script (npm run build).',
    icon: 'Hammer',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.build) return null;
      return [{ label: 'npm run build', command: 'npm run build' }];
    },
    producesArtifacts: () => [
      { name: 'dist', glob: 'dist/**/*', mime: 'application/octet-stream' },
      { name: 'build', glob: 'build/**/*', mime: 'application/octet-stream' },
    ],
  },
  {
    key: 'test',
    name: 'Run tests',
    description: 'Run the project\'s test suite (npm test).',
    icon: 'FlaskConical',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.test) return null;
      return [{ label: 'npm test', command: 'npm test' }];
    },
  },
  {
    key: 'lint',
    name: 'Lint',
    description: 'Run the project\'s linter (npm run lint).',
    icon: 'ScanLine',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.lint) return null;
      return [{ label: 'npm run lint', command: 'npm run lint' }];
    },
  },
  {
    key: 'docker-build',
    name: 'Docker build',
    description: 'Build a Docker image from the project\'s Dockerfile.',
    icon: 'Container',
    kinds: ['node'],
    applies: (_d, projectRoot) => fileExists(projectRoot, 'Dockerfile'),
    secrets: ['DOCKER_REGISTRY'],
    requiresApproval: false,
    build: (d) => {
      if (d.type !== 'node') return null;
      const name = projectName(d);
      return [
        {
          label: 'docker build',
          // DOCKER_REGISTRY is optional; if set, prefix the image name with
          // "$DOCKER_REGISTRY/". If unset, build a local-only image.
          command: `docker build -t "\${DOCKER_REGISTRY:+\$DOCKER_REGISTRY/}${name}:latest" .`,
        },
        {
          label: 'save image tarball',
          // Save the image to a tarball so the runner can capture it as an artifact.
          command: `docker save -o docker-image.tar "\${DOCKER_REGISTRY:+\$DOCKER_REGISTRY/}${name}:latest"`,
        },
      ];
    },
    producesArtifacts: (_d, _root) => [
      { name: 'docker-image', glob: 'docker-image.tar', mime: 'application/x-tar' },
    ],
  },
  {
    key: 'docker-push',
    name: 'Docker push',
    description: 'Push the previously-built Docker image to a registry.',
    icon: 'UploadCloud',
    kinds: ['node'],
    applies: (_d, projectRoot) => fileExists(projectRoot, 'Dockerfile'),
    secrets: ['DOCKER_REGISTRY', 'DOCKER_USERNAME', 'DOCKER_PASSWORD'],
    requiresApproval: true,
    build: (d) => {
      if (d.type !== 'node') return null;
      const name = projectName(d);
      return [
        { label: 'docker login', command: 'echo "$DOCKER_PASSWORD" | docker login "$DOCKER_REGISTRY" -u "$DOCKER_USERNAME" --password-stdin' },
        { label: 'docker push', command: `docker push "$DOCKER_REGISTRY/${name}:latest"` },
        { label: 'docker logout', command: 'docker logout "$DOCKER_REGISTRY" || true' },
      ];
    },
  },
  {
    key: 'npm-audit',
    name: 'npm audit',
    description: 'Check dependencies for known vulnerabilities (npm audit).',
    icon: 'ShieldCheck',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      return [{ label: 'npm audit', command: 'npm audit --audit-level=moderate || true' }];
    },
  },
  {
    key: 'npm-outdated',
    name: 'npm outdated',
    description: 'List outdated dependencies (npm outdated).',
    icon: 'Clock',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      return [{ label: 'npm outdated', command: 'npm outdated || true' }];
    },
  },
  {
    key: 'coverage',
    name: 'Coverage',
    description: 'Run tests with coverage and capture a JUnit report.',
    icon: 'PercentCircle',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.test) return null;
      return [{ label: 'npm test -- --coverage', command: 'npm test -- --coverage' }];
    },
    testReport: { format: 'junit', path: 'coverage/junit.xml' },
    producesArtifacts: () => [
      { name: 'coverage', glob: 'coverage/**/*', mime: 'application/octet-stream' },
    ],
  },
  {
    key: 'format-check',
    name: 'Format check',
    description: 'Check code formatting with Prettier (best-effort, non-blocking).',
    icon: 'AlignLeft',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      // Best-effort: never fail the run on formatting issues.
      return [{ label: 'prettier --check', command: 'npx --no-install prettier --check . || echo "Prettier check failed (non-blocking)"' }];
    },
  },
  {
    key: 'license-check',
    name: 'License check',
    description: 'Summarize all dependency licenses (license-checker).',
    icon: 'ScrollText',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      return [{ label: 'license-checker', command: 'npx --no-install license-checker --summary || npx license-checker --summary || true' }];
    },
  },
  {
    key: 'release',
    name: 'Release (patch)',
    description: 'Bump the patch version, commit, and tag (requires approval).',
    icon: 'Tag',
    kinds: ['node'],
    requiresApproval: true,
    build: (d) => {
      if (d.type !== 'node') return null;
      return [
        { label: 'npm version patch', command: 'npm version patch --no-git-tag-version' },
        {
          label: 'commit + tag',
          command: 'NEW_VERSION=$(node -p "require(\'./package.json\').version") && (git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add -A && git commit -m "chore: release v$NEW_VERSION" && git tag "v$NEW_VERSION" || echo "Not a git repo — skipping commit/tag")',
        },
      ];
    },
  },
];

// ---------------------------------------------------------------------------
// Rust workflows
// ---------------------------------------------------------------------------

const rustWorkflows: Workflow[] = [
  {
    key: 'cargo-build',
    name: 'cargo build',
    description: 'Compile the crate with `cargo build`.',
    icon: 'Hammer',
    kinds: ['rust'],
    cache: {
      label: 'cargo-target',
      paths: ['target'],
      keyGenerator: 'cargo',
    },
    build: () => [{ label: 'cargo build', command: 'cargo build --release' }],
  },
  {
    key: 'cargo-test',
    name: 'cargo test',
    description: 'Run the crate\'s test suite with `cargo test`.',
    icon: 'FlaskConical',
    kinds: ['rust'],
    cache: {
      label: 'cargo-target',
      paths: ['target'],
      keyGenerator: 'cargo',
    },
    build: () => [{ label: 'cargo test', command: 'cargo test' }],
  },
  {
    key: 'cargo-clippy',
    name: 'cargo clippy',
    description: 'Run clippy with `-D warnings` (lints that fail the build).',
    icon: 'ScanLine',
    kinds: ['rust'],
    build: () => [{ label: 'cargo clippy', command: 'cargo clippy -- -D warnings' }],
  },
  {
    key: 'cargo-audit',
    name: 'cargo audit',
    description: 'Check dependencies for known CVEs (cargo-audit).',
    icon: 'ShieldCheck',
    kinds: ['rust'],
    build: () => [{ label: 'cargo audit', command: 'cargo audit || cargo install --locked cargo-audit && cargo audit' }],
  },
];

// ---------------------------------------------------------------------------
// Go workflows
// ---------------------------------------------------------------------------

const goWorkflows: Workflow[] = [
  {
    key: 'go-build',
    name: 'go build',
    description: 'Compile all packages with `go build ./...`.',
    icon: 'Hammer',
    kinds: ['go'],
    cache: {
      label: 'go-build-cache',
      paths: ['/root/.cache/go-build'],
      keyGenerator: 'go',
    },
    build: () => [{ label: 'go build', command: 'go build ./...' }],
  },
  {
    key: 'go-test',
    name: 'go test',
    description: 'Run all tests with `go test ./...`.',
    icon: 'FlaskConical',
    kinds: ['go'],
    build: () => [{ label: 'go test', command: 'go test ./...' }],
  },
  {
    key: 'go-vet',
    name: 'go vet',
    description: 'Run `go vet ./...` for suspicious constructs.',
    icon: 'ScanLine',
    kinds: ['go'],
    build: () => [{ label: 'go vet', command: 'go vet ./...' }],
  },
  {
    key: 'go-coverage',
    name: 'go coverage',
    description: 'Run `go test` with coverage and capture a JUnit report.',
    icon: 'PercentCircle',
    kinds: ['go'],
    build: () => [
      { label: 'go test -coverprofile', command: 'go test -coverprofile=coverage.out ./...' },
      // Convert Go's coverage output to JUnit if go-junit-report is available;
      // otherwise emit a placeholder so the run still succeeds.
      {
        label: 'go-junit-report',
        command: 'go-junit-report < coverage.out > report.xml 2>/dev/null || echo "go-junit-report not installed — skipping report conversion"',
      },
    ],
    testReport: { format: 'junit', path: 'report.xml' },
  },
];

// ---------------------------------------------------------------------------
// Python workflows
// ---------------------------------------------------------------------------

const pythonWorkflows: Workflow[] = [
  {
    key: 'pip-install',
    name: 'pip install',
    description: 'Install dependencies from requirements.txt or pyproject.toml.',
    icon: 'Package',
    kinds: ['python'],
    cache: {
      label: 'pip-cache',
      paths: ['.venv'],
      keyGenerator: 'python',
    },
    build: (d) => {
      if (d.type !== 'python') return null;
      if (d.requirementsTxt) return [{ label: 'pip install', command: 'pip install -r requirements.txt' }];
      if (d.pyproject) return [{ label: 'pip install .', command: 'pip install .' }];
      return [{ label: 'pip install .', command: 'pip install .' }];
    },
  },
  {
    key: 'pytest',
    name: 'pytest',
    description: 'Run tests with pytest (if installed).',
    icon: 'FlaskConical',
    kinds: ['python'],
    build: () => [{ label: 'pytest', command: 'pytest -v' }],
  },
  {
    key: 'pip-audit',
    name: 'pip-audit',
    description: 'Audit Python dependencies for known vulnerabilities.',
    icon: 'ShieldCheck',
    kinds: ['python'],
    build: () => [{ label: 'pip-audit', command: 'pip-audit || (pip install pip-audit && pip-audit) || safety check || true' }],
  },
  {
    key: 'py-coverage',
    name: 'pytest coverage',
    description: 'Run pytest with coverage and capture a JUnit report.',
    icon: 'PercentCircle',
    kinds: ['python'],
    build: () => [
      { label: 'pytest --cov', command: 'pytest --cov --cov-report=xml:coverage.xml --junitxml=pytest.xml' },
    ],
    testReport: { format: 'junit', path: 'pytest.xml' },
  },
];

// ---------------------------------------------------------------------------
// AxiomState workflows (apply to any project with a src/ directory)
// ---------------------------------------------------------------------------

const axiomWorkflows: Workflow[] = [
  {
    key: 'parse',
    name: 'Parse AST graph',
    description: 'Use the AxiomState parser to build a dependency graph from src/.',
    icon: 'GitFork',
    kinds: ['node', 'python', 'rust', 'go', 'unknown'],
    applies: (_d, projectRoot) => fileExists(projectRoot, 'src'),
    build: () => [
      { label: 'AxiomState parse', command: 'echo "AxiomState parse — handled by runner.ts (no shell command)"' },
    ],
  },
  {
    key: 'bundle',
    name: 'Bundle (topological)',
    description: 'Produce a topologically-ordered bundle from src/index.* using AxiomState.',
    icon: 'Box',
    kinds: ['node', 'python', 'rust', 'go', 'unknown'],
    applies: (_d, projectRoot) => fileExists(projectRoot, 'src'),
    build: () => [
      { label: 'AxiomState bundle', command: 'echo "AxiomState bundle — handled by runner.ts (no shell command)"' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Universal workflows
// ---------------------------------------------------------------------------

const universalWorkflows: Workflow[] = [
  {
    key: 'inspect',
    name: 'Inspect',
    description: 'Print project structure, file count, and detection summary.',
    icon: 'Search',
    kinds: ALL_KINDS,
    build: () => [
      { label: 'List root', command: 'ls -la' },
      { label: 'Count files', command: 'find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | wc -l' },
      { label: 'Tree (depth 2)', command: 'find . -maxdepth 2 -not -path "*/node_modules/*" -not -path "*/.git/*" | head -50' },
    ],
  },
  {
    key: 'deploy-ssh',
    name: 'Deploy (rsync + SSH restart)',
    description: 'rsync the project to a remote host and restart the service via SSH. Requires approval.',
    icon: 'Rocket',
    kinds: ALL_KINDS,
    secrets: ['DEPLOY_HOST', 'DEPLOY_PATH', 'SSH_PRIVATE_KEY'],
    requiresApproval: true,
    build: () => [
      {
        label: 'rsync to remote',
        command: 'rsync -avz --exclude node_modules --exclude .git --exclude target ./ "$DEPLOY_HOST:$DEPLOY_PATH/"',
      },
      {
        label: 'ssh restart',
        // Best-effort: may fail if pm2 / npm not present on remote.
        command: 'ssh "$DEPLOY_HOST" "cd \\"$DEPLOY_PATH\\" && npm install --production && pm2 restart all" || echo "SSH restart step failed (non-blocking)"',
      },
    ],
  },
  {
    key: 'deploy-rsync',
    name: 'Deploy (rsync only)',
    description: 'rsync the project to a remote host (no service restart). Requires approval.',
    icon: 'UploadCloud',
    kinds: ALL_KINDS,
    secrets: ['DEPLOY_HOST', 'DEPLOY_PATH'],
    requiresApproval: true,
    build: () => [
      {
        label: 'rsync to remote',
        command: 'rsync -avz --exclude node_modules --exclude .git --exclude target ./ "$DEPLOY_HOST:$DEPLOY_PATH/"',
      },
    ],
  },
  {
    key: 'db-migrate',
    name: 'Database migrate',
    description: 'Run database migrations (npm run migrate / Django manage.py migrate). Requires approval.',
    icon: 'Database',
    kinds: ['node', 'python'],
    requiresApproval: true,
    applies: (detection, projectRoot) => {
      if (detection.type === 'node') return hasNodeScript(detection, 'migrate');
      if (detection.type === 'python') return fileExists(projectRoot, 'manage.py');
      return false;
    },
    build: (d) => {
      if (d.type === 'node') {
        if (!d.scripts.migrate) return null;
        return [{ label: 'npm run migrate', command: 'npm run migrate' }];
      }
      if (d.type === 'python') {
        return [{ label: 'python manage.py migrate', command: 'python manage.py migrate' }];
      }
      return null;
    },
  },
  {
    key: 'security-scan',
    name: 'Security scan',
    description: 'Run the appropriate vulnerability scanner for this project kind.',
    icon: 'ShieldAlert',
    kinds: ALL_KINDS,
    build: (d) => {
      if (d.type === 'node') {
        return [
          { label: 'npm audit', command: 'npm audit --audit-level=moderate || true' },
          { label: 'retirejs', command: 'npx --no-install retirejs --path . || npx retirejs --path . || true' },
        ];
      }
      if (d.type === 'python') {
        return [{ label: 'pip-audit', command: 'pip-audit || (pip install pip-audit && pip-audit) || safety check || true' }];
      }
      if (d.type === 'rust') {
        return [{ label: 'cargo audit', command: 'cargo audit || cargo install --locked cargo-audit && cargo audit' }];
      }
      // go / unknown — no built-in scanner; surface a single placeholder.
      if (d.type === 'go') {
        return [{ label: 'govulncheck', command: 'go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./... || echo "govulncheck unavailable"' }];
      }
      return null;
    },
  },
  {
    key: 'build-apk',
    name: 'Build Android APK',
    description: 'Wrap HTML/JS/web assets into a signed, installable Android APK using a WebView. Outputs app-release.apk.',
    icon: 'Smartphone',
    kinds: ALL_KINDS,
    defaultTimeoutMs: 600_000, // 10 min — Gradle can be slow on first run
    build: () => {
      // Resolve the template script path at module load time (server-side).
      const scriptPath = path.resolve(process.cwd(), 'src/lib/forge/templates/build-apk.sh');
      // The output directory is a subdirectory of the project root so the
      // engine's artifact capture can find the APK afterwards.
      // Note: use double quotes so bash expands $FORGE_PROJECT_ROOT.
      return [
        {
          label: 'Build signed APK (WebView wrapper)',
          command: `bash "${scriptPath}" "$FORGE_PROJECT_ROOT" "$FORGE_PROJECT_ROOT/forge-apk-output" "ForgeApp" "app.forge.webview" "1.0.0"`,
        },
      ];
    },
    producesArtifacts: () => [
      { name: 'app-release.apk', glob: 'forge-apk-output/app-release.apk', mime: 'application/vnd.android.package-archive' },
    ],
  },
  {
    key: 'bundle-size',
    name: 'Bundle size',
    description: 'Build the project and report the bundle size of dist/.',
    icon: 'Ruler',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.build) return null;
      return [
        { label: 'npm run build', command: 'npm run build' },
        { label: 'report size', command: 'du -sh dist/ 2>/dev/null || du -sh build/ 2>/dev/null || echo "no build output found"' },
      ];
    },
    producesArtifacts: () => [
      { name: 'dist', glob: 'dist/**/*', mime: 'application/octet-stream' },
    ],
  },
];

export const ALL_WORKFLOWS: Workflow[] = [
  ...nodeWorkflows,
  ...rustWorkflows,
  ...goWorkflows,
  ...pythonWorkflows,
  ...axiomWorkflows,
  ...universalWorkflows,
];

export function getWorkflow(key: string): Workflow | undefined {
  return ALL_WORKFLOWS.find(w => w.key === key);
}

/**
 * List workflows applicable to the given project kind + detection.
 * If `projectRoot` is provided, the optional `applies(detection, projectRoot)`
 * predicate is consulted (e.g. for Dockerfile checks). If omitted, workflows
 * without `applies` are listed; workflows with `applies` are listed too
 * (with the predicate skipped, treating it as true).
 */
export function workflowsForKind(
  kind: ProjectKind,
  detection: Detection,
  projectRoot?: string,
): Workflow[] {
  return ALL_WORKFLOWS.filter(w => {
    if (!w.kinds.includes(kind)) return false;
    // `build` must return non-null for this detection.
    if (w.build(detection) === null) return false;
    // `applies` predicate (only when projectRoot is available).
    if (w.applies && projectRoot) {
      try {
        if (!w.applies(detection, projectRoot)) return false;
      } catch {
        // If the predicate throws (e.g. fs error), be conservative and skip.
        return false;
      }
    }
    return true;
  });
}
