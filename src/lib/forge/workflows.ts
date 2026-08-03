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
  // Plugin flag: when true, this workflow is implemented by a
  // `WorkflowPlugin` registered in `./workflow-plugins.ts` (e.g. the
  // AxiomState `parse` / `bundle` workflows). The engine checks the
  // plugin registry FIRST and, if a plugin is registered for this
  // workflow's key, dispatches to `plugin.execute()` instead of
  // running shell steps. `build()` should return `[]` (empty) — the
  // steps are ignored when a plugin is registered.
  plugin?: boolean;
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
    description: 'Smart install: npm install + prisma generate + auto-detect missing modules from source.',
    icon: 'Package',
    kinds: ['node'],
    cache: { label: 'node_modules', paths: ['node_modules'], keyGenerator: 'node' },
    build: () => [
      { label: 'Detect package manager', command: 'if [ -f pnpm-lock.yaml ]; then PM=pnpm; elif [ -f yarn.lock ]; then PM=yarn; elif [ -f bun.lockb ]; then PM=bun; else PM=npm; fi; echo "Package manager: $PM"; echo "$PM" > .forge-pm' },
      { label: 'npm install (with fallback)', command: 'PM=$(cat .forge-pm 2>/dev/null || echo npm); if [ "$PM" = "npm" ]; then npm install --no-audit --no-fund 2>&1 || npm install --no-audit --no-fund --legacy-peer-deps 2>&1; elif [ "$PM" = "pnpm" ]; then pnpm install 2>&1; elif [ "$PM" = "yarn" ]; then yarn install 2>&1; elif [ "$PM" = "bun" ]; then bun install 2>&1; fi' },
      { label: 'Generate Prisma Client', command: 'if [ -f prisma/schema.prisma ] || [ -f schema.prisma ]; then echo "Prisma schema detected — running prisma generate..."; PM=$(cat .forge-pm 2>/dev/null || echo npm); if [ "$PM" = "npm" ]; then npx prisma generate 2>&1 || echo "Warning: prisma generate failed"; elif [ "$PM" = "pnpm" ]; then pnpm exec prisma generate 2>&1 || echo "Warning: prisma generate failed"; elif [ "$PM" = "yarn" ]; then yarn prisma generate 2>&1 || echo "Warning: prisma generate failed"; elif [ "$PM" = "bun" ]; then bunx prisma generate 2>&1 || echo "Warning: prisma generate failed"; fi; else echo "No Prisma schema detected — skipping prisma generate."; fi' },
      { label: 'Auto-detect & install missing modules', command: 'cat > /tmp/forge-check-deps.js << "ENDSCRIPT"\nconst fs = require("fs");\nconst path = require("path");\nconst { execSync } = require("child_process");\nlet declared = {};\ntry { const p = JSON.parse(fs.readFileSync("package.json","utf8")); declared = Object.assign({}, p.dependencies||{}, p.devDependencies||{}); } catch(e) {}\nconst dirs = ["src","app","lib","components","pages"].filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });\nconst exts = [".ts",".tsx",".js",".jsx",".mjs"];\nconst files = [];\n(function walk(dir) { try { fs.readdirSync(dir, {withFileTypes:true}).forEach(function(e) { if (e.name.startsWith(".") || e.name === "node_modules") return; var full = path.join(dir, e.name); if (e.isDirectory()) walk(full); else if (exts.some(function(x){return e.name.endsWith(x);})) files.push(full); }); } catch(e) {} });\ndirs.forEach(walk);\nvar importRe = /(?:from|require|import)\\s*["\x27]([^"\x27]+)["\x27]/g;\nvar imports = {};\nfiles.slice(0,1000).forEach(function(f) { var src = fs.readFileSync(f,"utf8"); var m; while ((m = importRe.exec(src)) !== null) { var mod = m[1]; if (mod.startsWith(".") || mod.startsWith("node:")) continue; if (mod.startsWith("@/")) continue; var pkg = mod.startsWith("@") ? mod.split("/").slice(0,2).join("/") : mod.split("/")[0]; imports[pkg] = true; } });\nvar missing = [];\nObject.keys(imports).forEach(function(pkg) { if (declared[pkg]) return; try { require.resolve(pkg); } catch(e) { missing.push(pkg); } });\nif (missing.length === 0) { console.log("All source imports resolved. No missing modules detected."); }\nelse { console.log("Found missing modules: " + missing.join(" ")); missing.forEach(function(pkg) { console.log("Installing " + pkg + "..."); try { execSync("npm install --no-audit --no-fund " + pkg, {stdio:"inherit"}); } catch(e) { console.log("Warning: could not install " + pkg); } }); console.log("Done installing missing modules."); }\nENDSCRIPT\nnode /tmp/forge-check-deps.js\nrm -f /tmp/forge-check-deps.js' },
    ],
  },
  {
    key: 'build',
    name: 'Build',
    description: 'Smart build: cleans stale caches, auto-fixes missing modules, handles prerender errors.',
    icon: 'Hammer',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.build) return null;
      return [
        { label: 'Clean stale build caches', command: 'rm -rf .next dist build .turbo 2>/dev/null || true\nrm -rf node_modules/.cache 2>/dev/null || true\nrm -f *.tsbuildinfo 2>/dev/null || true\necho "✓ Cleaned stale build caches"' },
        { label: 'Ensure dependencies installed', command: 'if [ ! -d node_modules ]; then echo "node_modules not found — running npm install..."; npm install --no-audit --no-fund 2>&1 || npm install --no-audit --no-fund --legacy-peer-deps 2>&1; fi\nif [ -f prisma/schema.prisma ] && [ ! -d node_modules/.prisma/client ]; then echo "Prisma client not generated — running prisma generate..."; npx prisma generate 2>&1 || echo "Warning: prisma generate failed"; fi\necho "✓ Dependencies ready"' },
        { label: 'Prepare environment', command: 'if [ ! -f bun.lock ] && [ ! -f bun.lockb ] && [ ! -f package-lock.json ] && [ ! -f pnpm-lock.yaml ] && [ ! -f yarn.lock ]; then echo \'{"name":"forge-build-project","version":"0.0.0","lockfileVersion":1}\' > package-lock.json; fi\nBUILD_SCRIPT=$(node -e "try{const p=require(\'./package.json\');console.log(p.scripts?.build||\'\')}catch{}" 2>/dev/null)\nif echo "$BUILD_SCRIPT" | grep -q "standalone"; then CFG_FILE=""; for f in next.config.ts next.config.js next.config.mjs; do if [ -f "$f" ]; then CFG_FILE="$f"; break; fi; done; if [ -n "$CFG_FILE" ] && ! grep -q "standalone" "$CFG_FILE"; then echo "Build script expects standalone — simplifying to \'next build\'"; cp package.json package.json.forge-backup; node -e "var fs=require(\'fs\');var p=JSON.parse(fs.readFileSync(\'package.json\',\'utf8\'));p.scripts.build=\'next build\';fs.writeFileSync(\'package.json\',JSON.stringify(p,null,2));"; fi; fi\necho "✓ Build environment prepared"' },
        { label: 'Smart build (with auto-fix)', command: 'for attempt in 1 2 3; do\n  echo "=== Build attempt $attempt ==="\n  output=$(npm run build 2>&1)\n  exit_code=$?\n  echo "$output"\n  if [ $exit_code -eq 0 ]; then echo "Build succeeded."; exit 0; fi\n  missing=$(echo "$output" | grep "Can" | grep "resolve" | head -5)\n  if [ -z "$missing" ]; then echo "Build failed - not a missing module issue."; exit 1; fi\n  echo "Missing modules detected. Installing..."\n  for mod in $missing; do npm install --no-audit --no-fund "$mod" 2>&1 || true; done\ndone\nexit 1' },
      ];
    },
    producesArtifacts: () => [
      { name: 'dist', glob: 'dist/**/*', mime: 'application/octet-stream' },
      { name: 'build', glob: 'build/**/*', mime: 'application/octet-stream' },
      { name: 'next', glob: '.next/**/*', mime: 'application/octet-stream' },
    ],
  },
  {
    key: 'build-incremental',
    name: 'Build (Incremental)',
    description: 'Fast rebuild — skips install if package.json unchanged, skips prisma generate if schema unchanged.',
    icon: 'Zap',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.build) return null;
      return [
        { label: 'Prepare environment', command: 'if [ ! -f bun.lock ] && [ ! -f bun.lockb ] && [ ! -f package-lock.json ] && [ ! -f pnpm-lock.yaml ] && [ ! -f yarn.lock ]; then echo \'{"name":"forge-build-project","version":"0.0.0","lockfileVersion":1}\' > package-lock.json; fi\nBUILD_SCRIPT=$(node -e "try{const p=require(\'./package.json\');console.log(p.scripts?.build||\'\')}catch{}" 2>/dev/null)\nif echo "$BUILD_SCRIPT" | grep -q "standalone"; then CFG_FILE=""; for f in next.config.ts next.config.js next.config.mjs; do if [ -f "$f" ]; then CFG_FILE="$f"; break; fi; done; if [ -n "$CFG_FILE" ] && ! grep -q "standalone" "$CFG_FILE"; then echo "Simplifying build script..."; cp package.json package.json.forge-backup; node -e "var fs=require(\'fs\');var p=JSON.parse(fs.readFileSync(\'package.json\',\'utf8\'));p.scripts.build=\'next build\';fs.writeFileSync(\'package.json\',JSON.stringify(p,null,2));"; fi; fi\necho "✓ Environment prepared"' },
        { label: 'Smart incremental rebuild', command: 'NEEDS_INSTALL=false\nif [ ! -d node_modules ]; then NEEDS_INSTALL=true; elif [ -f .forge-pkg-hash ]; then CURRENT_HASH=$(md5sum package.json | cut -d\' \' -f1); STORED_HASH=$(cat .forge-pkg-hash 2>/dev/null); if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then NEEDS_INSTALL=true; else echo "✓ package.json unchanged — skipping install"; fi; else NEEDS_INSTALL=true; fi\nif [ "$NEEDS_INSTALL" = "true" ]; then npm install --no-audit --no-fund 2>&1 || npm install --no-audit --no-fund --legacy-peer-deps 2>&1; md5sum package.json | cut -d\' \' -f1 > .forge-pkg-hash; fi\nif [ -f prisma/schema.prisma ]; then if [ ! -d node_modules/.prisma/client ]; then echo "Prisma client missing — generating..."; npx prisma generate 2>&1 || echo "Warning: prisma generate failed"; else SCHEMA_HASH=$(md5sum prisma/schema.prisma | cut -d\' \' -f1); STORED_SCHEMA=$(cat .forge-schema-hash 2>/dev/null); if [ "$SCHEMA_HASH" != "$STORED_SCHEMA" ]; then echo "Prisma schema changed — regenerating..."; npx prisma generate 2>&1 || echo "Warning: prisma generate failed"; md5sum prisma/schema.prisma | cut -d\' \' -f1 > .forge-schema-hash; else echo "✓ Prisma schema unchanged — skipping generate"; fi; fi; fi\necho "=== Incremental build ==="\nfor attempt in 1 2; do\n  output=$(npm run build 2>&1)\n  exit_code=$?\n  echo "$output"\n  if [ $exit_code -eq 0 ]; then echo "✓ Build succeeded."; exit 0; fi\n  if echo "$output" | grep -q "Compiled successfully" && echo "$output" | grep -q "prerender"; then echo "⚠ Prerender failed — retrying with SKIP_PRERENDER..."; output=$(NEXT_SKIP_PRERENDER=1 npm run build 2>&1 || true); exit_code=$?; echo "$output"; if [ $exit_code -eq 0 ]; then echo "✓ Build succeeded with prerender skipped."; exit 0; fi; for f in src/app/layout.tsx src/app/layout.ts app/layout.tsx; do if [ -f "$f" ] && ! grep -q "force-dynamic" "$f"; then sed -i \'1i export const dynamic = "force-dynamic";\\n\' "$f"; echo "  Added force-dynamic to $f"; break; fi; done; continue; fi\n  break\ndone\nexit 1' },
      ];
    },
    producesArtifacts: () => [{ name: 'next', glob: '.next/**/*', mime: 'application/octet-stream' }],
  },
  {
    key: 'dev-server',
    name: 'Dev Server (Live)',
    description: 'Starts npm run dev with a 5-minute timeout. Server stays alive while the run is active.',
    icon: 'Play',
    kinds: ['node'],
    defaultTimeoutMs: 300_000,
    build: (d) => {
      if (d.type !== 'node') return null;
      if (!d.scripts.dev) return null;
      return [{ label: 'Start dev server (npm run dev)', command: 'echo "Starting dev server..."\necho "⚠ The server will stop when this run ends (timeout 5 min)."\necho "⚠ Cancel this run to stop the server early."\necho ""\nnpm run dev 2>&1' }];
    },
  },
  {
    key: 'sync-changes',
    name: 'Sync Changes (Hash Check)',
    description: 'Detects what files changed since the last run. Shows a diff summary.',
    icon: 'RefreshCw',
    kinds: ALL_KINDS,
    build: () => [{ label: 'Detect file changes since last run', command: 'if [ ! -f .forge-file-hash ]; then echo "No previous hash found — first run. Recording current state."; find src app lib components pages -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.json" -o -name "*.css" -o -name "*.html" -o -name "*.md" \\) 2>/dev/null | sort | xargs md5sum 2>/dev/null > .forge-file-hash; echo "✓ Recorded $(wc -l < .forge-file-hash) files"; exit 0; fi\nfind src app lib components pages -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.json" -o -name "*.css" -o -name "*.html" -o -name "*.md" \\) 2>/dev/null | sort | xargs md5sum 2>/dev/null > .forge-file-hash-new\necho "=== File Changes Since Last Run ==="\nCHANGED=$(diff .forge-file-hash .forge-file-hash-new | grep "^>" | wc -l); REMOVED=$(diff .forge-file-hash .forge-file-hash-new | grep "^<" | wc -l)\nif [ "$CHANGED" -eq 0 ] && [ "$REMOVED" -eq 0 ]; then echo "✓ No changes detected since last run."; else if [ "$CHANGED" -gt 0 ]; then echo "📝 Modified or added files ($CHANGED):"; diff .forge-file-hash .forge-file-hash-new | grep "^>" | sed \'s/^> //\' | cut -d\' \' -f3- | while read f; do echo "  + $f"; done; fi; if [ "$REMOVED" -gt 0 ]; then echo "🗑️ Removed files ($REMOVED):"; diff .forge-file-hash .forge-file-hash-new | grep "^<" | sed \'s/^< //\' | cut -d\' \' -f3- | while read f; do echo "  - $f"; done; fi; fi\nmv .forge-file-hash-new .forge-file-hash\necho ""\necho "✓ Change detection complete"' }],
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
//
// These two workflows don't execute shell commands — they call into
// the AxiomState parser/writer/bundler directly. The actual execution
// lives in `./axiomstate-plugin.ts`, which registers `WorkflowPlugin`
// entries for the `parse` and `bundle` keys with the global plugin
// registry (`./workflow-plugins.ts`). The engine checks the registry
// FIRST and, if a plugin is registered, dispatches to it instead of
// running shell steps.
//
// The catalog still owns the metadata (name, description, icon,
// `kinds`, `applies` predicate) so the workflow shows up correctly
// in `workflowsForKind` and the UI. `build: () => []` returns an
// empty array — those steps would never run because the plugin
// takes over execution before `build()` is ever consulted by the
// engine. The `plugin: true` flag is what tells the catalog reader
// (and any future tooling) that this workflow is plugin-backed.

const axiomWorkflows: Workflow[] = [
  {
    key: 'parse',
    name: 'Parse AST graph',
    description: 'Use the AxiomState parser to build a dependency graph from src/.',
    icon: 'GitFork',
    kinds: ['node', 'python', 'rust', 'go', 'unknown'],
    applies: (_d, projectRoot) => fileExists(projectRoot, 'src'),
    plugin: true,
    build: () => [],
  },
  {
    key: 'bundle',
    name: 'Bundle (topological)',
    description: 'Produce a topologically-ordered bundle from src/index.* using AxiomState.',
    icon: 'Box',
    kinds: ['node', 'python', 'rust', 'go', 'unknown'],
    applies: (_d, projectRoot) => fileExists(projectRoot, 'src'),
    plugin: true,
    build: () => [],
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
  {
    key: 'static-export',
    name: 'Static export build',
    description: 'Build a static site (Next.js export via BUILD_APK=1 / Vite / plain) into out or dist, ready for Forge static deploys.',
    icon: 'PackageOpen',
    kinds: ['node'],
    build: (d) => {
      if (d.type !== 'node' || !d.scripts?.build) return null;
      return [
        {
          label: 'Build static output',
          command: 'if [ -f next.config.ts ] || [ -f next.config.js ] || [ -f next.config.mjs ] || [ -f next.config.cjs ]; then BUILD_APK=1 npm run build; else npm run build; fi',
        },
        {
          label: 'Verify output',
          command: 'test -d out || test -d dist || test -d build || (echo "no static output dir found (out/dist/build)" && exit 1)',
        },
      ];
    },
    producesArtifacts: () => [
      { name: 'static-site (out)', glob: 'out/**/*', mime: 'application/octet-stream' },
      { name: 'static-site (dist)', glob: 'dist/**/*', mime: 'application/octet-stream' },
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
