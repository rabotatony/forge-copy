// ============================================================
// Forge — Deploy engine
//   Phase 1: static deploys (file_server)
//   Phase 2: node app deploys (reverse_proxy + systemd)
// ============================================================
// Self-hosted, Netlify/Vercel-style deployments with no external
// provider and no build-minute quotas:
//
//   <FORGE_SITES_ROOT>/<slug>/
//     releases/<version>/            immutable snapshots
//     current -> releases/<version>  atomic symlink (zero downtime)
//     systemd/                       unit + activate script (node apps)
//     app.json                       runtime info (node apps)
//
// A deploy copies a build-output directory into a new immutable
// release, then atomically swaps the `current` symlink. Rollback
// simply points the symlink back at a previous release. Old
// releases are pruned automatically (FORGE_DEPLOY_KEEP).
//
// Two target kinds:
//   static — output is served as files (Caddy file_server + SPA fallback)
//   node   — output is a Next.js `standalone` dir or any Node app with
//            a server entry. Forge assigns a stable upstream port,
//            generates a systemd unit, and Caddy reverse-proxies to it.
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
//   FORGE_APP_PORT_BASE    first port for node apps (default: 4100)
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
// Node app deploys (Phase 2)
// ------------------------------------------------------------

export interface NodePublishResult extends PublishResult {
  port: number;
  serviceName: string;
  startCommand: string;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable upstream port for a node app (never changes between deploys). */
export function appPortFor(slug: string): number {
  const base = Number.parseInt(process.env.FORGE_APP_PORT_BASE ?? '4100', 10);
  const safeBase = Number.isFinite(base) && base > 1024 ? base : 4100;
  return safeBase + (hashCode(safeSlug(slug)) % 400);
}

export function nodeServiceName(slug: string): string {
  return `forge-app-${safeSlug(slug)}.service`;
}

/** Sanitize a start command like "node server.js". Blocks shell metachars. */
export function sanitizeStartCommand(input: string | undefined): string {
  const cmd = (input ?? 'node server.js').trim();
  if (!cmd || cmd.length > 200) throw new Error('Invalid start command');
  if (/[\n\r;&|<>`$"'\\]/.test(cmd)) {
    throw new Error('Start command contains forbidden characters');
  }
  const tokens = cmd.split(/\s+/);
  if (tokens.length > 8) throw new Error('Start command too long');
  const runners = ['node', 'bun', 'deno', 'npm', 'pnpm', 'yarn', 'python', 'python3'];
  const first = tokens[0].split('/').pop() ?? '';
  if (!runners.includes(first)) {
    throw new Error(`Start command must begin with one of: ${runners.join(', ')}`);
  }
  return cmd;
}

function writeNodeServiceBundle(opts: {
  site: string;
  slug: string;
  port: number;
  startCommand: string;
}): { unitPath: string; activatePath: string } {
  const svc = nodeServiceName(opts.slug);
  const systemdDir = path.join(opts.site, 'systemd');
  fs.mkdirSync(systemdDir, { recursive: true });

  const unit = [
    '[Unit]',
    `Description=Forge app: ${opts.slug}`,
    'After=network.target',
    '',
    '[Service]',
    `WorkingDirectory=${path.join(opts.site, 'current')}`,
    `ExecStart=/usr/bin/env ${opts.startCommand}`,
    `Environment=PORT=${opts.port}`,
    'Environment=NODE_ENV=production',
    'Environment=HOSTNAME=0.0.0.0',
    `EnvironmentFile=-${path.join(opts.site, 'runtime.env')}`,
    'Restart=always',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');

  const unitPath = path.join(systemdDir, svc);
  fs.writeFileSync(unitPath, unit);

  const activate = [
    '#!/usr/bin/env bash',
    '# Install/refresh the systemd unit for this Forge app, then (re)start it.',
    'set -euo pipefail',
    `sudo install -m 644 "${unitPath}" /etc/systemd/system/${svc}`,
    'sudo systemctl daemon-reload',
    `sudo systemctl enable --now ${svc}`,
    `sudo systemctl restart ${svc}`,
    `sudo systemctl status ${svc} --no-pager | head -12`,
    '',
  ].join('\n');

  const activatePath = path.join(systemdDir, 'activate.sh');
  fs.writeFileSync(activatePath, activate, { mode: 0o755 });

  return { unitPath, activatePath };
}

/**
 * Publish a Node app release (e.g. Next.js `standalone` output).
 * The release dir must contain the server entry (server.js for Next).
 * Writes systemd unit + activate script and app.json runtime info.
 */
export function publishNodeRelease(opts: {
  slug: string;
  sourceDir: string;
  startCommand?: string;
  meta?: Record<string, unknown>;
}): NodePublishResult {
  const slug = safeSlug(opts.slug);
  const startCommand = sanitizeStartCommand(opts.startCommand);
  const source = path.resolve(opts.sourceDir);

  const entry = path.join(source, 'server.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `server.js not found in ${opts.sourceDir}. ` +
        'For Next.js use output:"standalone" and set outputDir to the standalone folder.',
    );
  }

  const result = publishRelease({
    slug,
    sourceDir: source,
    meta: { kind: 'node', startCommand, ...(opts.meta ?? {}) },
  });

  const site = siteDir(slug);
  const port = appPortFor(slug);
  const { unitPath, activatePath } = writeNodeServiceBundle({
    site, slug, port, startCommand,
  });

  fs.writeFileSync(
    path.join(site, 'app.json'),
    JSON.stringify(
      {
        slug,
        kind: 'node',
        port,
        startCommand,
        serviceName: nodeServiceName(slug),
        currentVersion: result.version,
        unitPath,
        activatePath,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  return { ...result, port, serviceName: nodeServiceName(slug), startCommand };
}

export interface AppInfo {
  slug: string;
  kind: string;
  port: number;
  startCommand: string;
  serviceName: string;
  currentVersion: string | null;
}

export function readAppInfo(slug: string): AppInfo | null {
  const p = path.join(siteDir(slug), 'app.json');
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as AppInfo;
    parsed.currentVersion = currentVersion(siteDir(slug));
    return parsed;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// systemd service control (best effort — manual steps on failure)
// ------------------------------------------------------------

export interface ServiceActionResult {
  ok: boolean;
  action: string;
  slug: string;
  serviceName: string;
  output?: string;
  manual: string[];
}

export function serviceControl(
  slug: string,
  action: 'start' | 'stop' | 'restart',
): ServiceActionResult {
  const s = safeSlug(slug);
  const svc = nodeServiceName(s);
  const site = siteDir(s);
  const unitPath = path.join(site, 'systemd', svc);
  const manual = [
    `sudo install -m 644 "${unitPath}" /etc/systemd/system/${svc}`,
    'sudo systemctl daemon-reload',
    `sudo systemctl enable --now ${svc}`,
    action === 'stop' ? `sudo systemctl stop ${svc}` : `sudo systemctl restart ${svc}`,
  ];
  try {
    const out = execSync(`systemctl ${action} ${svc}`, {
      timeout: 20000,
      stdio: 'pipe',
    }).toString();
    return { ok: true, action, slug: s, serviceName: svc, output: out || 'ok', manual: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, action, slug: s, serviceName: svc, output: msg.slice(0, 500), manual };
  }
}

export interface ServiceStatusResult {
  slug: string;
  serviceName: string;
  port: number;
  unitInstalled: boolean;
  activeState?: string;
  subState?: string;
  mainPid?: string;
}

export function serviceStatus(slug: string): ServiceStatusResult {
  const s = safeSlug(slug);
  const svc = nodeServiceName(s);
  const site = siteDir(s);
  const unitInstalled = fs.existsSync(path.join(site, 'systemd', svc));
  const result: ServiceStatusResult = {
    slug: s,
    serviceName: svc,
    port: appPortFor(s),
    unitInstalled,
  };
  try {
    const out = execSync(
      `systemctl show -p ActiveState -p SubState -p MainPID --value ${svc}`,
      { timeout: 10000, stdio: 'pipe' },
    ).toString().trim().split('\n');
    result.activeState = out[0];
    result.subState = out[1];
    result.mainPid = out[2];
  } catch {
    result.activeState = 'unknown';
  }
  return result;
}

// ------------------------------------------------------------
// Caddy provisioning
// ------------------------------------------------------------

/** Validate a hostname (optionally wildcard). Used for custom domains. */
export function isValidHost(host: string): boolean {
  return /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host.trim());
}

/**
 * Write (or refresh) the Caddy snippet that serves a site.
 * static: file_server from the `current` symlink (SPA fallback).
 * app:    reverse_proxy to an upstream port.
 * aliases: extra hostnames (e.g. custom domain) served by the same site.
 */
export function provisionCaddySite(opts: {
  slug: string;
  mode?: 'static' | 'app';
  upstreamPort?: number;
  aliases?: string[];
}): { snippetPath: string; host: string } {
  const slug = safeSlug(opts.slug);
  const domain = forgeDomain();
  const host = domain ? `${slug}.${domain}` : `${slug}.forge.local`;
  const site = siteDir(slug);

  const aliases = (opts.aliases ?? []).map((a) => a.trim()).filter(isValidHost);
  const addresses = [host, ...aliases.filter((a) => a !== host)].join(', ');

  const body =
    opts.mode === 'app' && opts.upstreamPort
      ? [
          `${addresses} {`,
          '\tencode gzip zstd',
          `\treverse_proxy localhost:${Number(opts.upstreamPort)} {`,
          '\t\theader_up Host {host}',
          '\t\theader_up X-Real-IP {remote_host}',
          '\t\theader_up X-Forwarded-For {remote_host}',
          '\t\theader_up X-Forwarded-Proto {scheme}',
          '\t}',
          '}',
        ]
      : [
          `${addresses} {`,
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
  fs.rmSync(path.join(caddySitesDir(), `${safeSlug(slug)}.caddy`), { force: true });
}
