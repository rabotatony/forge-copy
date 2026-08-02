// ============================================================
// Forge — project kind detector
// ============================================================
// Looks at the extracted project root and identifies what kind
// of project it is (Node, Python, Rust, Go, …) plus which
// workflows make sense to offer.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

export type ProjectKind = 'node' | 'python' | 'rust' | 'go' | 'unknown';

export interface NodeDetection {
  type: 'node';
  packageName: string | null;
  packageVersion: string | null;
  scripts: Record<string, string>;
  engines: Record<string, string> | null;
  dependencies: number;
  devDependencies: number;
}

export interface PythonDetection {
  type: 'python';
  pyproject: boolean;
  requirementsTxt: boolean;
  setupPy: boolean;
  projectName: string | null;
}

export interface RustDetection {
  type: 'rust';
  crateName: string | null;
  crateVersion: string | null;
}

export interface GoDetection {
  type: 'go';
  moduleName: string | null;
  goVersion: string | null;
}

export interface UnknownDetection {
  type: 'unknown';
  hints: string[];
}

export type Detection =
  | NodeDetection
  | PythonDetection
  | RustDetection
  | GoDetection
  | UnknownDetection;

export interface DetectionResult {
  kind: ProjectKind;
  detection: Detection;
  // Suggested workflow keys (subset of WORKFLOWS below).
  suggestedWorkflows: string[];
  // Total file count under the extracted root (excluding common junk dirs).
  fileCount: number;
  // Total bytes of the extracted project (recursive).
  totalBytes: number;
}

export function detectProject(rootDir: string): DetectionResult {
  const pkgJsonPath = path.join(rootDir, 'package.json');
  const pyprojectPath = path.join(rootDir, 'pyproject.toml');
  const requirementsPath = path.join(rootDir, 'requirements.txt');
  const setupPyPath = path.join(rootDir, 'setup.py');
  const cargoPath = path.join(rootDir, 'Cargo.toml');
  const goModPath = path.join(rootDir, 'go.mod');

  let detection: Detection;
  let kind: ProjectKind = 'unknown';
  let suggested: string[] = [];

  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
        name?: string; version?: string; scripts?: Record<string, string>;
        engines?: Record<string, string>;
        dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>;
      };
      const scripts = pkg.scripts ?? {};
      detection = {
        type: 'node',
        packageName: pkg.name ?? null,
        packageVersion: pkg.version ?? null,
        scripts,
        engines: pkg.engines ?? null,
        dependencies: Object.keys(pkg.dependencies ?? {}).length,
        devDependencies: Object.keys(pkg.devDependencies ?? {}).length,
      };
      kind = 'node';
      // Always offer install + inspect.
      suggested.push('install', 'inspect');
      if (scripts.build) suggested.push('build');
      if (scripts.test || scripts['test:ci']) suggested.push('test');
      if (scripts.lint) suggested.push('lint');
      // AxiomState workflows only make sense for TS/JS projects with src/.
      if (fs.existsSync(path.join(rootDir, 'src'))) {
        suggested.push('parse', 'bundle');
      }
    } catch {
      detection = { type: 'unknown', hints: ['package.json present but invalid JSON'] };
    }
  } else if (fs.existsSync(cargoPath)) {
    const text = fs.readFileSync(cargoPath, 'utf-8');
    const nameMatch = text.match(/^name\s*=\s*"([^"]+)"/m);
    const versionMatch = text.match(/^version\s*=\s*"([^"]+)"/m);
    detection = {
      type: 'rust',
      crateName: nameMatch?.[1] ?? null,
      crateVersion: versionMatch?.[1] ?? null,
    };
    kind = 'rust';
    suggested = ['cargo-build', 'cargo-test', 'inspect'];
  } else if (fs.existsSync(goModPath)) {
    const text = fs.readFileSync(goModPath, 'utf-8');
    const moduleMatch = text.match(/^module\s+(\S+)/m);
    const goMatch = text.match(/^go\s+(\S+)/m);
    detection = {
      type: 'go',
      moduleName: moduleMatch?.[1] ?? null,
      goVersion: goMatch?.[1] ?? null,
    };
    kind = 'go';
    suggested = ['go-build', 'go-test', 'inspect'];
  } else if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath) || fs.existsSync(setupPyPath)) {
    let projectName: string | null = null;
    if (fs.existsSync(pyprojectPath)) {
      const text = fs.readFileSync(pyprojectPath, 'utf-8');
      const m = text.match(/^name\s*=\s*"([^"]+)"/m);
      projectName = m?.[1] ?? null;
    }
    detection = {
      type: 'python',
      pyproject: fs.existsSync(pyprojectPath),
      requirementsTxt: fs.existsSync(requirementsPath),
      setupPy: fs.existsSync(setupPyPath),
      projectName,
    };
    kind = 'python';
    suggested = ['pip-install', 'pytest', 'inspect'];
  } else {
    const hints: string[] = [];
    if (fs.existsSync(path.join(rootDir, 'README.md'))) hints.push('README.md');
    if (fs.existsSync(path.join(rootDir, 'Makefile'))) hints.push('Makefile');
    if (fs.existsSync(path.join(rootDir, 'Dockerfile'))) hints.push('Dockerfile');
    detection = { type: 'unknown', hints };
    suggested = ['inspect'];
  }

  const { fileCount, totalBytes } = countFiles(rootDir);
  return {
    kind,
    detection,
    suggestedWorkflows: Array.from(new Set(suggested)),
    fileCount,
    totalBytes,
  };
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv',
]);

function countFiles(rootDir: string): { fileCount: number; totalBytes: number } {
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (e.isFile()) {
        fileCount++;
        try { totalBytes += fs.statSync(full).size; } catch { /* ignore */ }
      }
    }
  };
  visit(rootDir);
  return { fileCount, totalBytes };
}
