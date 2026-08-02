// ============================================================
// Forge — git operations library
// ============================================================
// A small, typed wrapper around `git` invoked via spawn() WITHOUT a
// shell. Every call:
//   • passes args as an argv array (no shell interpolation),
//   • has a hard timeout (default 30s) with SIGTERM then SIGKILL,
//   • drains stdout + stderr so the child never blocks on a full
//     pipe buffer,
//   • returns a typed GitResult { exitCode, stdout, stderr }.
//
// Higher-level helpers (pullRepo, fetchRepo, listBranches, gitLog,
// gitStatus, checkoutBranch, cloneRepo, detectProvider) are built on
// top of the shared runGit() primitive.
//
// SECURITY: every URL/branch argument is run through
// `containsShellMetacharacters()` before spawning as defense-in-depth
// (matches the check used in the clone-repo route).
// ============================================================
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied';
}

export interface GitStatus {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
  clean: boolean;
  ahead: number;
  behind: number;
}

export interface BranchInfo {
  current: string;
  branches: Array<{ name: string; current: boolean; remote: boolean }>;
}

export interface GitLogEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

export interface CloneOptions {
  branch?: string;
  depth?: number;
  timeoutMs?: number;
}

export interface GitOperationOptions {
  timeoutMs?: number;
}

export interface GitLogOptions {
  max?: number;
  branch?: string;
}

// ---------------------------------------------------------------
// Security: defense-in-depth against shell metacharacters
// ---------------------------------------------------------------

// Same list as src/app/api/forge/clone-repo/route.ts — kept in sync.
const FORBIDDEN_PATTERNS = [';', '|', '&', '$(', '`', '\n', '\r', '\x00'];

export function containsShellMetacharacters(value: string): boolean {
  return FORBIDDEN_PATTERNS.some((p) => value.includes(p));
}

/**
 * Validate a git URL. Returns an Error if the URL is malformed or
 * contains forbidden characters, otherwise null.
 *
 * Allowed schemes: http://, https://, git@ (ssh).
 */
export function validateGitUrl(url: string): Error | null {
  if (!url) return new Error('URL is required');
  const schemeOk =
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('git@');
  if (!schemeOk) {
    return new Error('URL must start with http://, https://, or git@');
  }
  if (containsShellMetacharacters(url)) {
    return new Error('URL contains forbidden characters');
  }
  return null;
}

/**
 * Validate a git branch (refname) — same rules as the clone-repo
 * route. Returns an Error if invalid, otherwise null.
 */
export function validateGitBranch(branch: string): Error | null {
  if (!branch) return new Error('branch is required');
  if (
    containsShellMetacharacters(branch) ||
    branch.includes('..') ||
    branch.includes('\\') ||
    branch.includes(' ') ||
    branch.startsWith('-') ||
    /[\x00-\x1f\x7f]/.test(branch)
  ) {
    return new Error('branch contains invalid characters');
  }
  return null;
}

// ---------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------

/**
 * Infer the git provider from a URL.
 *
 *   https://github.com/foo/bar         → 'github'
 *   git@github.com:foo/bar             → 'github'
 *   https://gitlab.com/foo/bar         → 'gitlab'
 *   https://bitbucket.org/foo/bar      → 'bitbucket'
 *   git@gitlab.example.com:foo/bar     → 'gitlab' (host-based fallback)
 *   anything else                      → 'other'
 */
export function detectProvider(url: string): GitProvider {
  const lower = url.toLowerCase();
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('gitlab.com')) return 'gitlab';
  if (lower.includes('bitbucket.org')) return 'bitbucket';
  // Self-hosted / enterprise instances — match by host keyword.
  if (/gitlab/i.test(lower)) return 'gitlab';
  if (/bitbucket/i.test(lower)) return 'bitbucket';
  if (/github/i.test(lower)) return 'github';
  return 'other';
}

// ---------------------------------------------------------------
// Shared runGit() primitive
// ---------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 2_000;

interface RunGitOptions {
  cwd?: string;
  timeoutMs?: number;
  // By default we feed /dev/null to stdin; pass a Buffer to write it.
  stdin?: Buffer | null;
}

/**
 * Spawn `git` with the given argv (NO shell). Drains stdout + stderr
 * into strings, applies a hard timeout (SIGTERM, then SIGKILL after
 * KILL_GRACE_MS), and always resolves with a GitResult (never rejects
 * — callers inspect exitCode).
 *
 * exitCode is -1 for spawn errors and -2 for timeouts, so callers can
 * distinguish them from a real git exit code.
 */
export function runGit(
  args: string[],
  opts: RunGitOptions = {},
): Promise<GitResult> {
  const cwd = opts.cwd;
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const stdinInput = opts.stdin ?? null;

  return new Promise<GitResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        // No shell — args are passed verbatim to execve().
        shell: false,
      });
    } catch (err) {
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode, stdout, stderr });
    };

    // Drain stdout / stderr so the child never blocks on a full pipe.
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      finish(code ?? -1);
    });
    child.on('error', (err) => {
      stderr += err.message;
      finish(-1);
    });

    // Write stdin (if any) and then close stdin so git doesn't block
    // waiting for input.
    if (stdinInput && stdinInput.length > 0) {
      try {
        child.stdin?.write(stdinInput);
      } catch {
        /* ignore write errors */
      }
    }
    try {
      child.stdin?.end();
    } catch {
      /* ignore */
    }

    // Hard timeout: SIGTERM, then SIGKILL after a short grace period.
    const timer = setTimeout(() => {
      stderr += `\n[git timeout after ${timeoutMs}ms — sending SIGTERM]`;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, KILL_GRACE_MS);
    }, timeoutMs);
    // Don't keep the Node event loop alive just for the timer.
    if (typeof timer.unref === 'function') timer.unref();
  });
}

// ---------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------

/**
 * `git pull --ff-only` in the given working directory.
 */
export function pullRepo(
  workDir: string,
  opts: GitOperationOptions = {},
): Promise<GitResult> {
  return runGit(['pull', '--ff-only'], {
    cwd: workDir,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * `git fetch` in the given working directory.
 */
export function fetchRepo(
  workDir: string,
  opts: GitOperationOptions = {},
): Promise<GitResult> {
  return runGit(['fetch', '--all'], {
    cwd: workDir,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * `git checkout <branch>` in the given working directory.
 * The branch is validated with validateGitBranch() first.
 */
export function checkoutBranch(
  workDir: string,
  branch: string,
): Promise<GitResult> {
  const err = validateGitBranch(branch);
  if (err) {
    return Promise.resolve({
      exitCode: -1,
      stdout: '',
      stderr: err.message,
    });
  }
  return runGit(['checkout', branch], { cwd: workDir });
}

/**
 * Clone a remote repository into `dest`. Used by the repo link
 * endpoint.
 *
 * Validates the URL + optional branch before spawning.
 */
export function cloneRepo(
  url: string,
  dest: string,
  opts: CloneOptions = {},
): Promise<GitResult> {
  const urlErr = validateGitUrl(url);
  if (urlErr) {
    return Promise.resolve({
      exitCode: -1,
      stdout: '',
      stderr: urlErr.message,
    });
  }

  const args: string[] = ['clone'];

  // Optional depth (shallow clone).
  if (typeof opts.depth === 'number' && opts.depth > 0) {
    args.push('--depth', String(opts.depth));
  }

  // Optional branch — validate before adding to argv.
  if (opts.branch) {
    const branchErr = validateGitBranch(opts.branch);
    if (branchErr) {
      return Promise.resolve({
        exitCode: -1,
        stdout: '',
        stderr: branchErr.message,
      });
    }
    args.push('--branch', opts.branch);
  }

  args.push(url, dest);

  return runGit(args, {
    cwd: path.dirname(dest) || undefined,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * List local + remote-tracking branches and the currently
 * checked-out branch.
 *
 * Uses:
 *   git rev-parse --abbrev-ref HEAD                        → current
 *   git branch -a --format='%(refname:short)|%(upstream:short)'
 *
 * The format string uses `|` as the separator between the branch
 * short name and its upstream tracking ref (which may be empty).
 */
export async function listBranches(workDir: string): Promise<BranchInfo> {
  // Current branch.
  const headRes = await runGit(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: workDir },
  );
  let current = '';
  if (headRes.exitCode === 0) {
    const name = headRes.stdout.trim();
    // "HEAD" means detached-HEAD; treat as no current branch.
    current = name && name !== 'HEAD' ? name : '';
  }

  // All branches (local + remote).
  const branchRes = await runGit(
    [
      'branch',
      '-a',
      '--format=%(refname:short)|%(upstream:short)',
    ],
    { cwd: workDir },
  );

  const branches: BranchInfo['branches'] = [];
  if (branchRes.exitCode === 0) {
    for (const rawLine of branchRes.stdout.split('\n')) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const sepIdx = line.indexOf('|');
      const name =
        sepIdx >= 0 ? line.slice(0, sepIdx).trim() : line.trim();
      if (!name) continue;
      // Skip the symbolic-ref pointer line e.g. "origin/HEAD -> origin/main".
      if (name.includes('->')) continue;
      branches.push({
        name,
        current: name === current,
        // A branch is "remote" if its short name starts with a
        // remote prefix like "origin/" — i.e. it's a remote-tracking
        // ref rather than a local branch.
        remote: /\/.+$/.test(name) && name.includes('/'),
      });
    }
  }

  return { current, branches };
}

/**
 * Return recent commits from `git log`.
 *
 * Uses a `|||`-separated format string so we can safely split even
 * if author/subject fields contain `|` characters (unlikely, but
 * `|||` is vanishingly rare in real data).
 *
 *   git log -n <max> [-- <branch>] --format='%H|||%an|||%ae|||%aI|||%s'
 *
 * Default max = 30.
 */
export async function gitLog(
  workDir: string,
  opts: GitLogOptions = {},
): Promise<GitLogEntry[]> {
  const max =
    typeof opts.max === 'number' && opts.max > 0 ? opts.max : 30;

  const args: string[] = ['log', `-n`, String(max)];

  // Optional branch — validate before adding to argv.
  if (opts.branch) {
    const branchErr = validateGitBranch(opts.branch);
    if (branchErr) return [];
    args.push(opts.branch);
  }

  // %H  full hash
  // %an author name
  // %ae author email
  // %aI author date, strict ISO 8601
  // %s  subject (first line of commit message)
  args.push('--format=%H|||%an|||%ae|||%aI|||%s');

  const res = await runGit(args, { cwd: workDir });
  if (res.exitCode !== 0) return [];

  const entries: GitLogEntry[] = [];
  for (const rawLine of res.stdout.split('\n')) {
    const line = rawLine;
    if (!line.trim()) continue;
    const parts = line.split('|||');
    if (parts.length < 5) continue;
    const [hash, author, email, date, ...rest] = parts;
    entries.push({
      hash: hash ?? '',
      author: author ?? '',
      email: email ?? '',
      date: date ?? '',
      subject: (rest.join('|||')) ?? '',
    });
  }
  return entries;
}

// ---------------------------------------------------------------
// git status (porcelain v1 + ahead/behind)
// ---------------------------------------------------------------

/**
 * Parse the porcelain v1 status output into FileChange entries.
 *
 * Porcelain v1 line format (without -z):
 *   XY <path>
 *   XY <path>\t<origpath>     (for renames/copies)
 *
 * X = staged status, Y = worktree status. We map each X (for staged)
 * and each Y (for unstaged) into a FileChange.
 *
 * With `-z`, entries are NUL-separated and rename/copy paths are
 * emitted as a separate NUL-terminated field.
 */
function parsePorcelain(
  output: string,
): { staged: FileChange[]; unstaged: FileChange[]; untracked: string[] } {
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];

  // -z splits on NUL.
  const tokens = output.split('\x00');
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === '') {
      i++;
      continue;
    }
    // The first two chars are XY, then a space, then the path.
    if (tok.length < 3) {
      i++;
      continue;
    }
    const x = tok[0] ?? ' ';
    const y = tok[1] ?? ' ';
    // After the 2-char status and a single space, the rest is the
    // path (which may itself contain spaces — that's why we use -z).
    const rest = tok.slice(2);
    const filePath = rest.startsWith(' ') ? rest.slice(1) : rest;
    if (!filePath) {
      i++;
      continue;
    }

    // For renames/copies (R/C in X or Y), porcelain v1 emits the
    // original path as the next NUL-separated field.
    let origPath: string | null = null;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      origPath = tokens[i + 1] ?? null;
      if (origPath !== null) i++;
    }

    // Untracked entries: "?? <path>" or "!! <path>" (ignored).
    if (x === '?' && y === '?') {
      untracked.push(filePath);
      i++;
      continue;
    }
    if (x === '!' && y === '!') {
      // Ignored file — skip.
      i++;
      continue;
    }

    // Staged change (X != ' ' and X != '?').
    const stagedStatus = porcelainStatusToKind(x);
    if (stagedStatus) {
      staged.push({
        path: origPath ? `${filePath} ← ${origPath}` : filePath,
        status: stagedStatus,
      });
    }

    // Unstaged change (Y != ' ' and Y != '?').
    const unstagedStatus = porcelainStatusToKind(y);
    if (unstagedStatus) {
      unstaged.push({
        path: origPath ? `${filePath} ← ${origPath}` : filePath,
        status: unstagedStatus,
      });
    }

    i++;
  }

  return { staged, unstaged, untracked };
}

/**
 * Map a porcelain v1 status character to our FileChange status kind.
 * Returns null for ' ' (unchanged) and '?' (untracked) — those are
 * handled separately.
 *
 *   M = modified
 *   A = added (new file staged)
 *   D = deleted
 *   R = renamed
 *   C = copied
 */
function porcelainStatusToKind(
  c: string,
): FileChange['status'] | null {
  switch (c) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return null;
  }
}

/**
 * Return the full git status: staged, unstaged, untracked, whether
 * the tree is clean, and ahead/behind counts relative to the
 * upstream tracking branch.
 *
 * Uses:
 *   git status --porcelain=v1 -z
 *   git rev-list --left-right --count @{u}...HEAD
 *
 * The ahead/behind command fails if there is no upstream configured
 * (detached HEAD, or a branch with no tracking ref) — we wrap it in
 * try/catch and report 0/0 in that case.
 */
export async function gitStatus(workDir: string): Promise<GitStatus> {
  const porcelainRes = await runGit(
    ['status', '--porcelain=v1', '-z'],
    { cwd: workDir },
  );

  let staged: FileChange[] = [];
  let unstaged: FileChange[] = [];
  let untracked: string[] = [];

  if (porcelainRes.exitCode === 0) {
    const parsed = parsePorcelain(porcelainRes.stdout);
    staged = parsed.staged;
    unstaged = parsed.unstaged;
    untracked = parsed.untracked;
  }

  // Ahead/behind — may fail if no upstream is configured.
  let ahead = 0;
  let behind = 0;
  try {
    const abRes = await runGit(
      ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
      { cwd: workDir },
    );
    if (abRes.exitCode === 0) {
      // Output: "<behind>\t<ahead>\n"
      const line = abRes.stdout.trim();
      const m = line.match(/^(\d+)\s+(\d+)$/);
      if (m) {
        behind = parseInt(m[1] ?? '0', 10) || 0;
        ahead = parseInt(m[2] ?? '0', 10) || 0;
      }
    }
  } catch {
    // No upstream — leave ahead/behind at 0.
  }

  const clean =
    staged.length === 0 &&
    unstaged.length === 0 &&
    untracked.length === 0;

  return { staged, unstaged, untracked, clean, ahead, behind };
}

// ---------------------------------------------------------------
// Repo presence check
// ---------------------------------------------------------------

/**
 * Return true if `dir` is inside a git work tree (i.e. a `.git`
 * entry exists in `dir` or any ancestor).
 */
export function isGitRepo(dir: string): boolean {
  if (!dir || !fs.existsSync(dir)) return false;
  let current = path.resolve(dir);
  while (true) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) return true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}
