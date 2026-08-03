// ============================================================
// Forge — Build Intelligence: project capability analyzer
// ============================================================
// Phase 1 of "Forge knows everything": given an extracted project
// workspace, infer what the project IS and what Forge can do with
// it — zero configuration. Pure file inspection: no builds, no
// network, no dependencies. Safe to run on every project page.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

export type Framework = 'next' | 'vite' | 'react-spa' | 'static' | 'node' | 'unknown';
export type BuildTarget = 'web-static' | 'web-ssr' | 'apk-android' | 'node-server';
export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm' | 'unknown';

export interface Capability { ok: boolean; blockers: string[]; warnings: string[] }

export interface NextConfigInfo {
  exists: boolean;
  file: string | null;
  output: string | null;
  hasEnvToggle: boolean;
  imagesUnoptimized: boolean;
  standalone: boolean;
}

export interface RouteInfo { path: string; file: string; dynamic: boolean }

export interface PageInfo {
  path: string;
  file: string;
  clientOnly: boolean;
  dynamic: boolean;
  serverDataFetch: boolean;
}

export interface ProjectAnalysis {
  framework: Framework;
  frameworkVersion: string | null;
  language: 'typescript' | 'javascript' | 'mixed' | 'unknown';
  packageManager: PackageManager;
  packageName: string | null;
  appIdSuggestion: string;
  scripts: Record<string, string>;
  counts: { files: number; codeFiles: number; pages: number; apiRoutes: number };
  nextConfig: NextConfigInfo;
  apiRoutes: RouteInfo[];
  pages: PageInfo[];
  capabilities: { staticExport: Capability; apkWrap: Capability; ssr: Capability };
  hasCapacitor: boolean;
  hasMiddleware: boolean;
  usesNextImage: boolean;
  recommendedTargets: BuildTarget[];
  suggestions: string[];
}

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'out', 'build', '.turbo',
  'coverage', '.cache', 'android', 'ios', '.vercel', '.netlify',
]);
const MAX_FILES = 8000;
const MAX_READ_BYTES = 512_000;
const HEAD_BYTES = 2000;

interface WalkResult { files: string[]; truncated: boolean }

function walk(root: string): WalkResult {
  const files: string[] = [];
  let truncated = false;
  const visit = (dir: string): void => {
    if (files.length >= MAX_FILES) { truncated = true; return; }
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (entry.name.startsWith('.') && entry.name !== '.github' && entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(full);
      } else if (entry.isFile()) {
        files.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  visit(root);
  return { files, truncated };
}

function readSafe(file: string, maxBytes = MAX_READ_BYTES): string | null {
  try {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

function head(file: string): string {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    fs.closeSync(fd);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch { return ''; }
}

function parseJsonSafe(file: string): Record<string, unknown> | null {
  const raw = readSafe(file, 2_000_000);
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

function detectPackageManager(root: string): PackageManager {
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function parseNextConfig(root: string): NextConfigInfo {
  const info: NextConfigInfo = {
    exists: false, file: null, output: null,
    hasEnvToggle: false, imagesUnoptimized: false, standalone: false,
  };
  for (const name of ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs']) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    info.exists = true;
    info.file = name;
    const raw = readSafe(full) ?? '';
    const outMatch = raw.match(/output\s*:\s*['"]([^'"]+)['"]/);
    if (outMatch) info.output = outMatch[1];
    if (/output\s*:\s*[^,}]*process\.env/.test(raw)) info.output = 'env-conditional';
    info.hasEnvToggle = /BUILD_APK|BUILD_MODE|BUILD_STATIC/.test(raw);
    info.imagesUnoptimized = /unoptimized\s*:\s*true/.test(raw);
    info.standalone = /['"]standalone['"]/.test(raw);
    break;
  }
  return info;
}

function fileToRoute(file: string, kind: 'api' | 'page'): string {
  let rel = file.replace(/\.(tsx?|jsx?|mdx)$/, '');
  if (kind === 'page') rel = rel.replace(/\/page$/i, '');
  if (kind === 'api') rel = rel.replace(/\/route$/i, '');
  rel = rel.replace(/^(src\/)?(app|pages)/, '');
  if (!rel.startsWith('/')) rel = '/' + rel;
  if (rel === '/') return '/';
  return rel.replace(/\/$/, '') || '/';
}

export function analyzeProject(root: string): ProjectAnalysis {
  const pkg = parseJsonSafe(path.join(root, 'package.json'));
  const deps = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };
  const scripts = (pkg?.scripts as Record<string, string>) ?? {};

  const framework: Framework = deps.next
    ? 'next'
    : deps.vite
      ? 'vite'
      : deps.react
        ? 'react-spa'
        : pkg
          ? 'node'
          : fs.existsSync(path.join(root, 'index.html')) ? 'static' : 'unknown';

  const { files } = walk(root);
  const isCode = (f: string) => /\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/.test(f);
  const codeFiles = files.filter(isCode);
  const tsFiles = codeFiles.filter(f => /\.(ts|tsx)$/.test(f));
  const language = codeFiles.length === 0 ? 'unknown'
    : tsFiles.length === codeFiles.length ? 'typescript'
    : tsFiles.length === 0 ? 'javascript' : 'mixed';

  const nextConfig = framework === 'next'
    ? parseNextConfig(root)
    : { exists: false, file: null, output: null, hasEnvToggle: false, imagesUnoptimized: false, standalone: false };

  const hasMiddleware = files.some(f => f === 'middleware.ts' || f === 'middleware.js' || f === 'src/middleware.ts');

  const apiRoutes: RouteInfo[] = [];
  const pages: PageInfo[] = [];
  let usesNextImage = false;

  for (const rel of files) {
    const isAppApi = /(^|\/)route\.(tsx?|js)$/.test(rel) && /(^|\/)(app|src\/app)\//.test(rel);
    const isPagesApi = /^pages\/api\//.test(rel) && /\.(tsx?|js)$/.test(rel);
    if (isAppApi || isPagesApi) {
      apiRoutes.push({ path: fileToRoute(rel, 'api'), file: rel, dynamic: /\[[^\]]+\]/.test(rel) });
      continue;
    }
    const isPage = /(^|\/)page\.(tsx?|jsx|mdx)$/.test(rel) && /(^|\/)(app|src\/app)\//.test(rel);
    const isPagesPage = /^pages\//.test(rel) && !/^pages\/api\//.test(rel) && /\.(tsx?|jsx|mdx)$/.test(rel) && !rel.includes('_');
    if (isPage || isPagesPage) {
      const full = path.join(root, rel);
      const headContent = head(full);
      const clientOnly = /^\s*(['"])use client\1/.test(headContent);
      const body = readSafe(full) ?? headContent;
      const serverDataFetch = !clientOnly && /(\bawait\s+fetch\(|getServerSideProps|generateMetadata|unstable_cache|cookies\(\)|headers\(\))/.test(body);
      pages.push({ path: fileToRoute(rel, 'page'), file: rel, clientOnly, dynamic: /\[[^\]]+\]/.test(rel), serverDataFetch });
      continue;
    }
    if (!usesNextImage && /\.(tsx|jsx)$/.test(rel)) {
      if (/from\s+['"]next\/image['"]/.test(head(path.join(root, rel)))) usesNextImage = true;
    }
  }

  const exportBlockers: string[] = [];
  const exportWarnings: string[] = [];
  if (framework === 'next') {
    if (hasMiddleware) exportBlockers.push('middleware.ts exists — not supported by output:"export"');
    const serverPages = pages.filter(p => p.serverDataFetch);
    if (serverPages.length > 0) {
      exportBlockers.push(`${serverPages.length} page(s) use server-side data fetching (${serverPages.slice(0, 3).map(p => p.path).join(', ')}${serverPages.length > 3 ? '…' : ''})`);
    }
    if (apiRoutes.length > 0) {
      exportWarnings.push(`${apiRoutes.length} API route(s) must be excluded from the static build (they need a server or must be dropped)`);
    }
    if (usesNextImage && !nextConfig.imagesUnoptimized) {
      exportWarnings.push('next/image detected — set images: { unoptimized: true } for export');
    }
    const usesSearchParams = files.filter(f => /\.(tsx|jsx)$/.test(f)).slice(0, 400)
      .some(f => /useSearchParams\(/.test(head(path.join(root, f))));
    if (usesSearchParams) exportWarnings.push('useSearchParams() detected — wrap in <Suspense> for export');
  } else if (framework === 'node') {
    exportBlockers.push('No static frontend framework detected (pure Node app?)');
  } else if (framework === 'unknown') {
    exportBlockers.push('Could not identify the project type');
  }

  const staticExport: Capability = { ok: exportBlockers.length === 0, blockers: exportBlockers, warnings: exportWarnings };

  const apkBlockers = [...exportBlockers];
  const apkWarnings = [...exportWarnings];
  const hasCapacitor = !!deps['@capacitor/core'] || !!deps['@capacitor/cli'];
  if (staticExport.ok && !hasCapacitor) {
    apkWarnings.push('Capacitor not installed yet — Forge can scaffold it (blueprint action "capacitor")');
  }
  const apkWrap: Capability = { ok: apkBlockers.length === 0, blockers: apkBlockers, warnings: apkWarnings };

  const ssrNeeded = pages.some(p => p.serverDataFetch) || apiRoutes.length > 0;
  const ssr: Capability = {
    ok: ssrNeeded,
    blockers: ssrNeeded ? [] : ['No server-side rendering or API usage detected — SSR not required'],
    warnings: [],
  };

  const recommendedTargets: BuildTarget[] = [];
  if (framework === 'static' || staticExport.ok) recommendedTargets.push('web-static');
  if (apkWrap.ok) recommendedTargets.push('apk-android');
  if (ssrNeeded) recommendedTargets.push('web-ssr');
  if ((framework === 'node' || framework === 'unknown') && !staticExport.ok) recommendedTargets.push('node-server');
  const deduped = [...new Set(recommendedTargets)];

  const suggestions: string[] = [];
  if (framework === 'next' && staticExport.ok && !nextConfig.hasEnvToggle) {
    suggestions.push('Add a BUILD_APK env toggle to next.config so export mode is opt-in (blueprint action "export-mode")');
  }
  if (apkWrap.ok && !hasCapacitor) {
    suggestions.push('Scaffold Capacitor config to wrap this project as an offline Android APK (blueprint action "capacitor")');
  }
  if (apkWrap.ok) {
    suggestions.push('Generate the GitHub Actions APK pipeline (blueprint action "apk-workflow") — free builds on public repos');
  }
  if (nextConfig.standalone && ssrNeeded) {
    suggestions.push('output:"standalone" detected — ideal for self-hosted Node deploy via Forge Deployments');
  }
  if (suggestions.length === 0) suggestions.push('No immediate actions — project is ready for the recommended targets');

  const rawName = typeof pkg?.name === 'string' ? pkg.name : null;
  const slug = (rawName ?? 'forgeapp').replace(/^@[^/]+\//, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'app';

  return {
    framework,
    frameworkVersion: deps.next ?? deps.vite ?? null,
    language,
    packageManager: detectPackageManager(root),
    packageName: rawName,
    appIdSuggestion: `app.${slug}.android`,
    scripts,
    counts: { files: files.length, codeFiles: codeFiles.length, pages: pages.length, apiRoutes: apiRoutes.length },
    nextConfig,
    apiRoutes,
    pages,
    capabilities: { staticExport, apkWrap, ssr },
    hasCapacitor,
    hasMiddleware,
    usesNextImage,
    recommendedTargets: deduped,
    suggestions,
  };
}
