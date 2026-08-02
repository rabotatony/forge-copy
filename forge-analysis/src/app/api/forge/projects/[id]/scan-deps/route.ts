// ============================================================
// Forge — dependency vulnerability scanner
// ============================================================
// Scans a project's dependency manifest for known vulnerable
// packages. Supports:
//   • npm  (package.json)         — full vuln matching
//   • pip  (requirements.txt)     — listed, vulnerable=false
//   • cargo (Cargo.toml)          — listed, vulnerable=false
//   • go   (go.mod)               — listed, vulnerable=false
//
// GET /api/forge/projects/[id]/scan-deps
// → { dependencies, summary }
// ============================================================
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Severity = 'low' | 'moderate' | 'high' | 'critical' | 'none';

interface Dependency {
  name: string;
  version: string;
  vulnerable: boolean;
  severity: Severity;
}

interface ScanResult {
  dependencies: Dependency[];
  summary: {
    total: number;
    vulnerable: number;
    bySeverity: Record<Severity, number>;
  };
}

interface KnownVuln {
  name: string;
  threshold: string;
  severity: Exclude<Severity, 'none'>;
  description: string;
}

// Hardcoded list of known-vulnerable packages (npm).
// A package is vulnerable if its installed version is strictly
// less than the listed threshold.
const KNOWN_VULNS: KnownVuln[] = [
  { name: 'lodash',       threshold: '4.17.21', severity: 'critical', description: 'Prototype pollution' },
  { name: 'axios',        threshold: '0.21.1',  severity: 'high',     description: 'SSRF / prototype pollution' },
  { name: 'moment',       threshold: '2.29.4',  severity: 'high',     description: 'ReDoS' },
  { name: 'handlebars',   threshold: '4.7.7',   severity: 'high',     description: 'RCE / prototype pollution' },
  { name: 'minimist',     threshold: '1.2.6',   severity: 'critical', description: 'Prototype pollution' },
  { name: 'ws',           threshold: '7.4.6',   severity: 'high',     description: 'DoS via overly large HTTP headers' },
  { name: 'node-forge',   threshold: '1.3.0',   severity: 'critical', description: 'Prototype pollution' },
  { name: 'ua-parser-js', threshold: '0.7.31',  severity: 'critical', description: 'Supply-chain compromise' },
];

// --- semver helpers -----------------------------------------------------

function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

/** Returns true if version a is strictly less than version b. */
function lt(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return true;
    if (pa[i]! > pb[i]!) return false;
  }
  return false;
}

/**
 * Strip npm range operators (^, ~, >=, <=, >, <, =, v) and any
 * pre-release / build metadata, returning just the bare semver
 * (or empty string if it can't be derived).
 */
function cleanNpmRange(range: string): string {
  const alt = (range.split('||')[0] ?? '').trim();
  const comp = (alt.split(/\s+/)[0] ?? '').trim();
  let s = comp.replace(/^[\^~>=<=v]+/, '');
  s = (s.split('-')[0] ?? '').split('+')[0] ?? '';
  return s.trim();
}

function checkNpm(name: string, versionRange: string): { vulnerable: boolean; severity: Severity } {
  const v = cleanNpmRange(versionRange);
  if (!v || !parseSemver(v)) return { vulnerable: false, severity: 'none' };
  for (const vuln of KNOWN_VULNS) {
    if (vuln.name === name && lt(v, vuln.threshold)) {
      return { vulnerable: true, severity: vuln.severity };
    }
  }
  return { vulnerable: false, severity: 'none' };
}

// --- per-ecosystem scanners --------------------------------------------

interface NpmPackage {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function scanNpm(root: string): Dependency[] {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  let pkg: NpmPackage;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as NpmPackage;
  } catch {
    return [];
  }
  const merged: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  const out: Dependency[] = [];
  for (const [name, range] of Object.entries(merged)) {
    const { vulnerable, severity } = checkNpm(name, range);
    out.push({ name, version: range, vulnerable, severity });
  }
  return out;
}

function scanPip(root: string): Dependency[] {
  const reqPath = path.join(root, 'requirements.txt');
  if (!fs.existsSync(reqPath)) return [];
  const out: Dependency[] = [];
  const text = fs.readFileSync(reqPath, 'utf-8');
  for (const rawLine of text.split('\n')) {
    const line = (rawLine.split('#')[0] ?? '').trim();
    if (!line) continue;
    // Skip options (-r, --index-url, ...) and environment markers.
    if (line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*(?:[=<>!~]+\s*([^;\s]+))?/);
    if (!m) continue;
    const name = m[1]!;
    const version = (m[2] ?? '').trim();
    out.push({ name, version, vulnerable: false, severity: 'none' });
  }
  return out;
}

function scanCargo(root: string): Dependency[] {
  const p = path.join(root, 'Cargo.toml');
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf-8');
  const sectionMatch = text.match(/\[dependencies\]([\s\S]*?)(?=\n\[|$)/);
  if (!sectionMatch) return [];
  const section = sectionMatch[1] ?? '';
  const out: Dependency[] = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Simple form: name = "1.2.3"
    const simple = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/);
    if (simple) {
      out.push({ name: simple[1]!, version: simple[2]!, vulnerable: false, severity: 'none' });
      continue;
    }
    // Inline table: name = { version = "1.2.3", ... }
    const table = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*\{\s*version\s*=\s*"([^"]+)"/);
    if (table) {
      out.push({ name: table[1]!, version: table[2]!, vulnerable: false, severity: 'none' });
      continue;
    }
  }
  return out;
}

function scanGo(root: string): Dependency[] {
  const p = path.join(root, 'go.mod');
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf-8');
  const out: Dependency[] = [];

  // Block form: require ( ... )
  const blockMatch = text.match(/require\s*\(([\s\S]*?)\)/);
  if (blockMatch) {
    for (const rawLine of (blockMatch[1] ?? '').split('\n')) {
      const line = (rawLine.split('//')[0] ?? '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        out.push({ name: parts[0]!, version: parts[1]!, vulnerable: false, severity: 'none' });
      }
    }
  }

  // Single-line form: require foo/bar v1.2.3
  const singleRe = /^require\s+([^\s]+)\s+([^\s]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = singleRe.exec(text)) !== null) {
    out.push({ name: m[1]!, version: m[2]!, vulnerable: false, severity: 'none' });
  }
  return out;
}

// --- route handler ------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    const root = project.extractedPath;
    if (!fs.existsSync(root)) {
      return Response.json({ error: 'Project files not found on disk' }, { status: 404 });
    }

    // Try each manifest in priority order; first non-empty result wins.
    let deps: Dependency[] = scanNpm(root);
    if (deps.length === 0) deps = scanPip(root);
    if (deps.length === 0) deps = scanCargo(root);
    if (deps.length === 0) deps = scanGo(root);

    const bySeverity: Record<Severity, number> = {
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      none: 0,
    };
    let vulnerable = 0;
    for (const d of deps) {
      bySeverity[d.severity]++;
      if (d.vulnerable) vulnerable++;
    }

    const result: ScanResult = {
      dependencies: deps,
      summary: { total: deps.length, vulnerable, bySeverity },
    };
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
