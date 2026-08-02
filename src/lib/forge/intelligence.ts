// ============================================================
// Forge — intelligent intent detection
// ============================================================
// Goes beyond "what kind of project is this?" (detector.ts) and
// answers "what does the user WANT to produce from this project?"
//
// A user who uploads an HTML file almost certainly wants an Android
// APK. A user who uploads a Rust crate probably wants a binary or a
// docker image. A user who uploads a Next.js app wants a deployment
// bundle. This module infers those intents from the file structure,
// manifest contents, and common patterns — then exposes them so the
// smart router (router.ts) can recommend the right workflows and even
// auto-run them.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Detection, ProjectKind } from './detector';
import { countFilesInDir } from './fs-utils';

// ---------------------------------------------------------------------------
// Intent types — the things a user might want to produce / do
// ---------------------------------------------------------------------------

export type Intent =
  | 'apk'            // Android APK (from HTML/WebView or native)
  | 'web-app'        // Deployable web application (static or SSR)
  | 'cli-binary'     // Command-line executable
  | 'desktop-app'    // Desktop application (Electron / Tauri)
  | 'docker-image'   // Containerized docker image
  | 'library'        // Publishable package (npm / crate / wheel)
  | 'api-server'     // HTTP API server to deploy
  | 'static-site'    // Static HTML/CSS/JS site to host
  | 'ios-app'        // iOS app (limited — requires macOS)
  | 'desktop-installer' // Windows/macOS/Linux installer
  | 'test-suite'     // Run tests + coverage
  | 'security-audit' // Security vulnerability scan
  | 'release-bundle' // Versioned release archive (ZIP/tarball)
  | 'source-inspect' // Just inspect / parse the source
  | 'unknown';

export interface IntentSignal {
  intent: Intent;
  /** Human-readable explanation of WHY this intent was detected. */
  reason: string;
  /** Confidence 0..1 — higher = more certain. */
  confidence: number;
  /** Evidence files/patterns that triggered this signal. */
  evidence: string[];
}

export interface IntentResult {
  /** The single strongest intent (highest confidence). */
  primary: Intent;
  /** All detected intents sorted by confidence descending. */
  signals: IntentSignal[];
  /** Human-readable summary, e.g. "Looks like a web app you want to ship as an APK". */
  summary: string;
  /** Suggested auto-run workflow sequence (keys from the workflow catalog). */
  suggestedAutoRun: string[];
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

interface Heuristic {
  intent: Intent;
  /** Returns confidence 0..1 plus evidence, or null if not applicable. */
  test: (ctx: ScanContext) => { confidence: number; evidence: string[]; reason: string } | null;
}

interface ScanContext {
  rootDir: string;
  detection: Detection;
  kind: ProjectKind;
  /** Top-level file names (lowercased) for fast membership checks. */
  topFiles: Set<string>;
  /** Top-level directory names. */
  topDirs: Set<string>;
  /** Recursively-collected file extensions → count. */
  extCounts: Map<string, number>;
  /** Total file count. */
  fileCount: number;
  /** Contents of package.json if present (parsed). */
  pkgJson: Record<string, unknown> | null;
  /** Raw index.html content if a top-level one exists (truncated). */
  indexHtml: string | null;
}

function buildContext(rootDir: string, detection: Detection, kind: ProjectKind): ScanContext {
  const topFiles = new Set<string>();
  const topDirs = new Set<string>();
  const extCounts = new Map<string, number>();

  try {
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (entry.isFile()) topFiles.add(entry.name.toLowerCase());
      else if (entry.isDirectory()) topDirs.add(entry.name.toLowerCase());
    }
  } catch {
    // ignore — rootDir unreadable
  }

  // Recursive extension counting (skip heavy dirs).
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv', '.cache']);
  const visit = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full, depth + 1);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (ext) extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
      }
    }
  };
  visit(rootDir, 0);

  // package.json
  let pkgJson: Record<string, unknown> | null = null;
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try { pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>; }
    catch { /* malformed */ }
  }

  // index.html (top-level or in public/)
  let indexHtml: string | null = null;
  const candidates = [
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'public', 'index.html'),
    path.join(rootDir, 'src', 'index.html'),
    path.join(rootDir, 'app', 'index.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try { indexHtml = fs.readFileSync(c, 'utf-8').slice(0, 4096); }
      catch { /* ignore */ }
      break;
    }
  }

  return { rootDir, detection, kind, topFiles, topDirs, extCounts, fileCount: 0, pkgJson, indexHtml };
}

const heuristics: Heuristic[] = [
  // --- APK intent ---
  {
    intent: 'apk',
    test: (ctx) => {
      const evidence: string[] = [];
      let confidence = 0;
      // Pure HTML project (no framework) → very likely wants APK
      const htmlCount = ctx.extCounts.get('.html') ?? 0;
      const jsCount = ctx.extCounts.get('.js') ?? 0;
      const tsCount = ctx.extCounts.get('.ts') ?? 0;
      if (htmlCount > 0 && tsCount === 0) {
        evidence.push(`${htmlCount} HTML file(s), no TypeScript`);
        confidence += 0.45;
      }
      // index.html at root
      if (ctx.topFiles.has('index.html')) {
        evidence.push('index.html at project root');
        confidence += 0.2;
      }
      // Capacitor / Cordova already present
      if (ctx.pkgJson) {
        const deps = { ...(ctx.pkgJson.dependencies as Record<string, string> ?? {}), ...(ctx.pkgJson.devDependencies as Record<string, string> ?? {}) };
        if (deps['@capacitor/core'] || deps['@capacitor/cli']) {
          evidence.push('@capacitor/core in dependencies');
          confidence += 0.5;
        }
        if (deps['cordova']) {
          evidence.push('cordova in dependencies');
          confidence += 0.5;
        }
      }
      // android/ directory
      if (ctx.topDirs.has('android')) {
        evidence.push('android/ directory present');
        confidence += 0.3;
      }
      if (confidence === 0) return null;
      return { confidence: Math.min(confidence, 0.98), evidence, reason: 'Project looks like an HTML/JS app that can be wrapped into an Android APK' };
    },
  },
  // --- Static site intent ---
  {
    intent: 'static-site',
    test: (ctx) => {
      const htmlCount = ctx.extCounts.get('.html') ?? 0;
      const cssCount = ctx.extCounts.get('.css') ?? 0;
      if (htmlCount >= 1 && cssCount >= 1 && !ctx.pkgJson) {
        return {
          confidence: 0.7,
          evidence: [`${htmlCount} HTML, ${cssCount} CSS, no package.json`],
          reason: 'Plain HTML/CSS site with no build tooling',
        };
      }
      return null;
    },
  },
  // --- Web app intent (Next.js / React) ---
  {
    intent: 'web-app',
    test: (ctx) => {
      if (!ctx.pkgJson) return null;
      const deps = { ...(ctx.pkgJson.dependencies as Record<string, string> ?? {}), ...(ctx.pkgJson.devDependencies as Record<string, string> ?? {}) };
      const evidence: string[] = [];
      let confidence = 0;
      if (deps['next']) { evidence.push('next in dependencies'); confidence += 0.6; }
      if (deps['react'] && deps['react-dom']) { evidence.push('react + react-dom'); confidence += 0.2; }
      if (deps['vue']) { evidence.push('vue in dependencies'); confidence += 0.4; }
      if (deps['svelte'] || deps['@sveltejs/kit']) { evidence.push('svelte in dependencies'); confidence += 0.4; }
      if (deps['astro']) { evidence.push('astro in dependencies'); confidence += 0.4; }
      if (confidence === 0) return null;
      return { confidence: Math.min(confidence, 0.95), evidence, reason: 'Web framework detected — deployable web application' };
    },
  },
  // --- API server intent ---
  {
    intent: 'api-server',
    test: (ctx) => {
      if (!ctx.pkgJson) return null;
      const deps = ctx.pkgJson.dependencies as Record<string, string> ?? {};
      const evidence: string[] = [];
      let confidence = 0;
      if (deps['express']) { evidence.push('express'); confidence += 0.5; }
      if (deps['fastify']) { evidence.push('fastify'); confidence += 0.5; }
      if (deps['koa']) { evidence.push('koa'); confidence += 0.5; }
      if (deps['hono']) { evidence.push('hono'); confidence += 0.5; }
      if (deps['@nestjs/core']) { evidence.push('@nestjs/core'); confidence += 0.6; }
      const scripts = ctx.pkgJson.scripts as Record<string, string> ?? {};
      if (scripts['start'] && /server|api|listen/.test(JSON.stringify(scripts))) {
        evidence.push('start script references server/api');
        confidence += 0.2;
      }
      if (confidence === 0) return null;
      return { confidence: Math.min(confidence, 0.9), evidence, reason: 'HTTP server framework detected' };
    },
  },
  // --- CLI binary intent ---
  {
    intent: 'cli-binary',
    test: (ctx) => {
      const evidence: string[] = [];
      let confidence = 0;
      if (ctx.kind === 'rust') {
        evidence.push('Rust crate');
        confidence += 0.4;
        // Check for bin target in Cargo.toml
        const cargoPath = path.join(ctx.rootDir, 'Cargo.toml');
        if (fs.existsSync(cargoPath)) {
          const text = fs.readFileSync(cargoPath, 'utf-8');
          if (/\[\[bin\]\]/.test(text) || /\bname\s*=/.test(text)) {
            evidence.push('Cargo.toml has bin target');
            confidence += 0.3;
          }
        }
      }
      if (ctx.kind === 'go') {
        evidence.push('Go module');
        confidence += 0.5;
        // main.go strongly implies a binary
        if (fs.existsSync(path.join(ctx.rootDir, 'main.go'))) {
          evidence.push('main.go present');
          confidence += 0.3;
        }
      }
      if (ctx.pkgJson) {
        const pkg = ctx.pkgJson as Record<string, unknown>;
        if (pkg['bin']) {
          evidence.push('"bin" field in package.json');
          confidence += 0.6;
        }
      }
      if (confidence === 0) return null;
      return { confidence: Math.min(confidence, 0.9), evidence, reason: 'Project structure suggests a command-line binary' };
    },
  },
  // --- Desktop app intent ---
  {
    intent: 'desktop-app',
    test: (ctx) => {
      if (!ctx.pkgJson) return null;
      const deps = { ...(ctx.pkgJson.dependencies as Record<string, string> ?? {}), ...(ctx.pkgJson.devDependencies as Record<string, string> ?? {}) };
      const evidence: string[] = [];
      let confidence = 0;
      if (deps['electron'] || deps['electron-builder']) { evidence.push('electron'); confidence += 0.7; }
      if (deps['@tauri-apps/api'] || deps['@tauri-apps/cli']) { evidence.push('tauri'); confidence += 0.7; }
      if (confidence === 0) return null;
      return { confidence: Math.min(confidence, 0.92), evidence, reason: 'Desktop application framework detected' };
    },
  },
  // --- Docker image intent ---
  {
    intent: 'docker-image',
    test: (ctx) => {
      if (ctx.topFiles.has('dockerfile')) {
        return { confidence: 0.8, evidence: ['Dockerfile at root'], reason: 'Dockerfile present — container build applicable' };
      }
      if (ctx.topFiles.has('docker-compose.yml') || ctx.topFiles.has('docker-compose.yaml')) {
        return { confidence: 0.6, evidence: ['docker-compose.yml at root'], reason: 'docker-compose present' };
      }
      return null;
    },
  },
  // --- Library intent ---
  {
    intent: 'library',
    test: (ctx) => {
      if (!ctx.pkgJson) return null;
      const pkg = ctx.pkgJson as Record<string, unknown>;
      const evidence: string[] = [];
      let confidence = 0;
      // "main" without "bin" + no server framework → library
      if (pkg['main'] && !pkg['bin']) {
        const deps = ctx.pkgJson.dependencies as Record<string, string> ?? {};
        const isServer = !!(deps['express'] || deps['fastify'] || deps['koa'] || deps['@nestjs/core']);
        if (!isServer) {
          evidence.push('"main" field, no "bin", no server framework');
          confidence += 0.5;
        }
      }
      // files field suggests publishable package
      if (pkg['files']) { evidence.push('"files" field (publishable)'); confidence += 0.2; }
      if (ctx.kind === 'rust') {
        evidence.push('Rust crate (publishable)');
        confidence += 0.3;
      }
      if (ctx.kind === 'python' && (ctx.detection.type === 'python' && ctx.detection.pyproject)) {
        evidence.push('pyproject.toml (publishable)');
        confidence += 0.3;
      }
      if (confidence === 0) return null;
      return { confidence: Math.min(confidence, 0.8), evidence, reason: 'Project looks like a publishable library/package' };
    },
  },
  // --- Test suite intent ---
  {
    intent: 'test-suite',
    test: (ctx) => {
      const evidence: string[] = [];
      let confidence = 0;
      const testFiles = (ctx.extCounts.get('.test.ts') ?? 0) + (ctx.extCounts.get('.test.tsx') ?? 0) + (ctx.extCounts.get('.test.js') ?? 0) + (ctx.extCounts.get('.spec.ts') ?? 0) + (ctx.extCounts.get('.test.py') ?? 0) + (ctx.extCounts.get('_test.go') ?? 0);
      if (testFiles >= 1) {
        evidence.push(`${testFiles} test file(s)`);
        confidence += Math.min(0.3 + testFiles * 0.1, 0.7);
      }
      if (ctx.pkgJson) {
        const scripts = ctx.pkgJson.scripts as Record<string, string> ?? {};
        if (scripts['test']) { evidence.push('npm test script'); confidence += 0.2; }
      }
      if (confidence === 0) return null;
      return { confidence: Math.min(confidence, 0.85), evidence, reason: 'Test files present — run the test suite' };
    },
  },
  // --- Security audit intent ---
  {
    intent: 'security-audit',
    test: (ctx) => {
      if (ctx.kind === 'node' && ctx.pkgJson) {
        const depCount = Object.keys(ctx.pkgJson.dependencies as Record<string, unknown> ?? {}).length;
        if (depCount >= 3) {
          return { confidence: 0.6, evidence: [`${depCount} dependencies — audit recommended`], reason: 'Many dependencies — security audit advisable' };
        }
      }
      return null;
    },
  },
  // --- Source inspect (always available fallback) ---
  {
    intent: 'source-inspect',
    test: (ctx) => {
      if (ctx.fileCount >= 0) {
        return { confidence: 0.2, evidence: ['always-available baseline'], reason: 'Inspect project structure' };
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Intent → preferred workflow keys (in priority order). Single source
// of truth — `router.ts` imports this rather than maintaining a
// parallel (and previously conflicting) table.
// ---------------------------------------------------------------------------
// NOTE: workflow keys must match the keys defined in `workflows.ts`.
// In particular, the release workflow is `release` (not `release-patch`).
const INTENT_WORKFLOWS: Record<Intent, string[]> = {
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
  'release-bundle': ['release', 'build', 'install'],
  'source-inspect': ['inspect', 'parse', 'bundle'],
  unknown: ['inspect'],
};

/**
 * Auto-run sequence for an intent — the ordered list of workflows to
 * execute when the user clicks "Auto-run" on a detected intent.
 *
 * Filters out `inspect` (which is informational only) and any
 * unknown intents default to `['inspect']`.
 */
export function autoRunForIntent(intent: Intent): string[] {
  const priority = INTENT_WORKFLOWS[intent] ?? ['inspect'];
  return priority.filter((key) => key !== 'inspect');
}

/**
 * Full priority list for an intent (including `inspect`). Used by
 * `router.ts` to compute the recommended-workflows panel.
 */
export function workflowsForIntent(intent: Intent): string[] {
  return INTENT_WORKFLOWS[intent] ?? ['inspect'];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectIntent(
  rootDir: string,
  detection: Detection,
  kind: ProjectKind,
): IntentResult {
  const ctx = buildContext(rootDir, detection, kind);
  ctx.fileCount = countFilesInDir(rootDir).fileCount;

  const signals: IntentSignal[] = [];
  for (const h of heuristics) {
    const r = h.test(ctx);
    if (r) {
      signals.push({
        intent: h.intent,
        reason: r.reason,
        confidence: r.confidence,
        evidence: r.evidence,
      });
    }
  }

  // Sort by confidence descending.
  signals.sort((a, b) => b.confidence - a.confidence);
  const primary = signals[0]?.intent ?? 'unknown';

  // Build auto-run sequence from primary intent, filtering out workflows
  // that don't exist in the catalog (caller will double-check applicability).
  const suggestedAutoRun = autoRunForIntent(primary);

  const summary = buildSummary(primary, signals, ctx);

  return { primary, signals, summary, suggestedAutoRun };
}

function buildSummary(primary: Intent, signals: IntentSignal[], ctx: ScanContext): string {
  const top = signals[0];
  if (!top) return 'Project analyzed — no strong intent detected. Use Inspect to explore.';

  switch (primary) {
    case 'apk': {
      const html = ctx.extCounts.get('.html') ?? 0;
      if (html > 0 && !ctx.topDirs.has('android')) {
        return `Detected ${html} HTML file(s) with no native Android code — Forge can wrap this into a signed Android APK using a WebView.`;
      }
      return 'Android project detected — Forge can build and sign an APK.';
    }
    case 'web-app':
      return 'Web application detected — Forge can install, build, and measure the bundle.';
    case 'static-site':
      return 'Static HTML/CSS site detected — Forge can inspect and bundle it.';
    case 'cli-binary':
      return kindBinarySummary(ctx);
    case 'desktop-app':
      return 'Desktop application detected — Forge can install and build it.';
    case 'docker-image':
      return 'Dockerfile detected — Forge can build a container image.';
    case 'library':
      return 'Publishable library detected — Forge can install, build, test, and lint it.';
    case 'api-server':
      return 'HTTP API server detected — Forge can install, build, and test it.';
    case 'test-suite':
      return 'Test files detected — Forge can run the test suite and generate coverage.';
    case 'security-audit':
      return 'Many dependencies detected — Forge can run a security audit.';
    case 'release-bundle':
      return 'Ready for release — Forge can build a versioned release bundle.';
    case 'source-inspect':
      return 'Forge can inspect and parse the project structure.';
    default:
      return top.reason;
  }
}

function kindBinarySummary(ctx: ScanContext): string {
  if (ctx.kind === 'rust') return 'Rust crate detected — Forge can build a release binary with `cargo build --release`.';
  if (ctx.kind === 'go') return 'Go module detected — Forge can build a static binary with `go build`.';
  if (ctx.pkgJson?.['bin']) return 'CLI package detected (bin field) — Forge can build and bundle it.';
  return 'Command-line binary project detected — Forge can build it.';
}

// ---------------------------------------------------------------------------
// Human-readable labels for the UI
// ---------------------------------------------------------------------------

export const INTENT_LABELS: Record<Intent, { label: string; emoji: string; description: string }> = {
  apk: { label: 'Android APK', emoji: '📱', description: 'Wrap into a signed, installable Android app' },
  'web-app': { label: 'Web App', emoji: '🌐', description: 'Install, build, and measure the web bundle' },
  'static-site': { label: 'Static Site', emoji: '📄', description: 'Bundle static HTML/CSS/JS for hosting' },
  'cli-binary': { label: 'CLI Binary', emoji: '⚙️', description: 'Compile a command-line executable' },
  'desktop-app': { label: 'Desktop App', emoji: '🖥️', description: 'Build an Electron/Tauri desktop app' },
  'docker-image': { label: 'Docker Image', emoji: '🐳', description: 'Build a containerized image' },
  library: { label: 'Library', emoji: '📦', description: 'Build, test, and lint a publishable package' },
  'api-server': { label: 'API Server', emoji: '🔗', description: 'Install, build, and test an HTTP server' },
  'ios-app': { label: 'iOS App', emoji: '🍎', description: 'Build an iOS app (requires macOS)' },
  'desktop-installer': { label: 'Installer', emoji: '💿', description: 'Build a desktop installer package' },
  'test-suite': { label: 'Test Suite', emoji: '🧪', description: 'Run tests and generate coverage' },
  'security-audit': { label: 'Security Audit', emoji: '🛡️', description: 'Scan dependencies for vulnerabilities' },
  'release-bundle': { label: 'Release Bundle', emoji: '🏷️', description: 'Build a versioned release archive' },
  'source-inspect': { label: 'Inspect Source', emoji: '🔍', description: 'Parse and explore the project structure' },
  unknown: { label: 'Unknown', emoji: '❓', description: 'No strong intent detected' },
};
