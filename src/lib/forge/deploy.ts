// ============================================================
// Forge — Deploy engine (Phase 1: static deploys)
// ============================================================
// Self-hosted, Netlify/Vercel-style deployments with no external
// provider and no build-minute quotas:
//
//   <FORGE_SITES_ROOT>/<slug>/
//     releases/<version>/            immutable snapshots
//     current -> releases/<version>  atomic symlink (zero downtime)
//
// A deploy copies a build-output directory into a new immutable
// release, then atomically swaps the `current` symlink. Rollback
// simply points the symlink back at a previous release. Old
// releases are pruned automatically (FORGE_DEPLOY_KEEP).
//
// Serving: the engine writes one Caddy snippet per site into
// FORGE_CADDY_SITES_DIR (default: ./caddy/sites-enabled), which the
// root Caddyfile imports. HTTPS is automatic via Let's Encrypt.
//
// Env vars:
//   FORGE_SITES_ROOT       root dir for published sites
//                          (default: <cwd>/storage/sites)
//   FORGE_CADDY_SITES_DIR  dir for generated Caddy snippets
//                          (default: <cwd>/caddy/sites-enabled)
//   FORGE_DOMAIN           base domain, e.g. forge.example.com ->
//                          sites are served at https://<slug>.<domain>
//   FORGE_DEPLOY_KEEP      releases to keep per site (default: 10)
//   FORGE_CADDY_RELOAD_CMD optional command run after writing
//                          snippets, e.g. "systemctl reload caddy"
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { PATHS } from '@/lib/forge/storage';

// ------------------------------------------------------------
// Paths & config
// ------------------------------------------------------------

export function sitesRoot(): string {
  const root = process.env.FORGE_SITES_ROOT || path.join(PATHS.root, 'sites');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function caddySitesDir(): string {
  const dir =
    process.env.FORGE_CADDY_SITES_DIR ||
    path.join(process.cwd(), 'caddy', 'sites-enabled');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keepReleases(): number {
  const n = Number.parseInt(process.env.FORGE_DEPLOY_KEEP ?? '10', 10);
  return Number.isFinite(n) && n >= 2 ? n : 10;
}

export function forgeDomain(): string | null {
  const d = (process.env.FORGE_DOMAIN ?? '').trim();
  return d ? d.replace(/^https?:\/\//, '').replace(/\/+$/, '') : null;
}

// ------------------------------------------------------------
// Slugs & URLs
// ------------------------------------------------------------

export function safeSlug(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return s || 'site';
}

/** Deterministic site slug for a project. */
export function projectSlug(project: { name: string; id: string }): string {
  return `${safeSlug(project.name)}-${project.id.slice(-6)}`.toLowerCase();
}

export function siteUrl(slug: string): string | null {
  const domain = forgeDomain();
  if (!domain) return null;
  return `https://${slug}.${domain}`;
}

export function siteDir(slug: string): string {
  return path.join(sitesRoot(), safeSlug(slug));
}

// ------------------------------------------------------------
// Path safety
// ------------------------------------------------------------

export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Resolve an optional relative subdir (e.g. "dist") inside root, safely. */
export function resolveOutputDir(root: string, subpath?: string): string {
  const resolvedRoot = path.resolve(root);
  if (!subpath || subpath.trim() === '' || subpath.trim() === '.') {
    return resolvedRoot;
  }
  const clean = subpath.trim().replace(/^\/+/, '');
  const target = path.resolve(resolvedRoot, clean);
  if (!isWithin(resolvedRoot, target)) {
    throw new Error(`outputDir escapes the source root: ${subpath}`);
  }
  return target;
}

// ------------------------------------------------------------
// Publish / rollback / list
// ------------------------------------------------------------

export interface PublishResult {
  slug: string;
  version: string;
  releaseDir: string;
  url: string | null;
  files: number;
  bytes: number;
}

function makeVersion(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${rand}`
  );
}

function dirStats(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

function swapSymlink(site: string, version: string): void {
  const current = path.join(site, 'current');
  const tmp = path.join(site, `.current-tmp-${Date.now()}`);
  fs.symlinkSync(path.join(site, 'releases', version), tmp);
  fs.renameSync(tmp, current); // atomic on POSIX
}

function pruneReleases(site: string): void {
  const releases = path.join(site, 'releases');
  if (!fs.existsSync(releases)) return;
  const current = currentVersion(site);
  const versions = fs
    .readdirSync(releases)
    .filter((v) => fs.statSync(path.join(releases, v)).isDirectory())
    .sort()
    .reverse();
  for (const v of versions.slice(keepReleases())) {
    if (v === current) continue;
    fs.rmSync(path.join(releases, v), { recursive: true, force: true });
  }
}

/**
 * Publish a new immutable release and atomically point `current` at it.
 * sourceDir must exist and contain the build output.
 */
export function publishRelease(opts: {
  slug: string;
  sourceDir: string;
  meta?: Record<string, unknown>;
}): PublishResult {
  const slug = safeSlug(opts.slug);
  const source = path.resolve(opts.sourceDir);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Deploy source not found: ${opts.sourceDir}`);
  }

  const site = siteDir(slug);
  const releases = path.join(site, 'releases');
  fs.mkdirSync(releases, { recursive: true });

  const version = makeVersion();
  const releaseDir = path.join(releases, version);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.cpSync(source, releaseDir, { recursive: true });

  fs.writeFileSync(
    path.join(releaseDir, '.forge-release.json'),
    JSON.stringify(
      { version, publishedAt: new Date().toISOString(), ...(opts.meta ?? {}) },
      null,
      2,
    ),
  );

  swapSymlink(site, version);
  pruneReleases(site);

  const { files, bytes } = dirStats(releaseDir);
  return { slug, version, releaseDir, url: siteUrl(slug), files, bytes };
}

export function currentVersion(site: string): string | null {
  try {
    return path.basename(fs.readlinkSync(path.join(site, 'current')));
  } catch {
    return null;
  }
}

export interface ReleaseInfo {
  version: string;
  createdAt: number;
  isCurrent: boolean;
  files: number;
  bytes: number;
}

export function listReleases(slug: string): ReleaseInfo[] {
  const site = siteDir(slug);
  const releases = path.join(site, 'releases');
  if (!fs.existsSync(releases)) return [];
  const current = currentVersion(site);
  return fs
    .readdirSync(releases)
    .filter((v) => fs.statSync(path.join(releases, v)).isDirectory())
    .map((v) => {
      const p = path.join(releases, v);
      const { files, bytes } = dirStats(p);
      return {
        version: v,
        createdAt: fs.statSync(p).birthtimeMs,
        isCurrent: v === current,
        files,
        bytes,
      };
    })
    .sort((a, b) => b.version.localeCompare(a.version));
}

export function rollbackToVersion(slug: string, version: string): void {
  const site = siteDir(slug);
  const releaseDir = path.join(site, 'releases', version);
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release ${version} no longer exists on disk (pruned?)`);
  }
  swapSymlink(site, version);
}

// ------------------------------------------------------------
// Caddy provisioning
// ------------------------------------------------------------

/**
 * Write (or refresh) the Caddy snippet that serves a site.
 * static: file_server from the `current` symlink (SPA fallback).
 * app:    reverse_proxy to an upstream port.
 */
export function provisionCaddySite(opts: {
  slug: string;
  mode?: 'static' | 'app';
  upstreamPort?: number;
}): { snippetPath: string; host: string } {
  const slug = safeSlug(opts.slug);
  const domain = forgeDomain();
  const host = domain ? `${slug}.${domain}` : `${slug}.forge.local`;
  const site = siteDir(slug);

  const body =
    opts.mode === 'app' && opts.upstreamPort
      ? [
          `${host} {`,
          '\tencode gzip zstd',
          `\treverse_proxy localhost:${Number(opts.upstreamPort)}`,
          '}',
        ]
      : [
          `${host} {`,
          '\tencode gzip zstd',
          `\troot * ${path.join(site, 'current')}`,
          '\tfile_server',
          '\ttry_files {path} /index.html',
          '}',
        ];

  const snippetPath = path.join(caddySitesDir(), `${slug}.caddy`);
  fs.writeFileSync(snippetPath, body.join('\n') + '\n');

  const reloadCmd = (process.env.FORGE_CADDY_RELOAD_CMD ?? '').trim();
  if (reloadCmd) {
    try {
      execSync(reloadCmd, { timeout: 15000 });
    } catch {
      // Reload is best-effort; the snippet is on disk either way.
    }
  }

  return { snippetPath, host };
}

export function removeCaddySite(slug: string): void {
  fs.rmSync(path.join(caddySitesDir(), `${safeSlug(slug)}.caddy`), {
    force: true,
  });
}
