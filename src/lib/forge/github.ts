// ============================================================
// Forge — first-class GitHub client
// ============================================================
// Wraps the GitHub REST API via `octokit`. Replaces the hand-rolled
// `fetch('https://api.github.com/...')` helpers that previously lived
// only inside the Experiments Lab (ghFetch / createFixPR / etc.) and
// were unreachable from the main app.
//
// Credentials are read from the global Forge settings store
// (`.forge-settings.json`, AES-256-GCM) — the same store the
// `github-settings.tsx` panel writes to. Owner/Repo come from the
// project's `repoUrl` (parsed) OR from the global GITHUB_OWNER /
// GITHUB_REPO plain settings (backwards-compat with experiments).
//
// Every function is project-aware: given a projectId it resolves the
// GitHub token + owner + repo once and returns a typed result.
// Failures throw a `GitHubError` with the upstream message.
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { db } from "@/lib/db";
import { getSettingsEncryptionKeyString } from "@/lib/forge/settings-key";

// Octokit is loaded lazily (only when getOctokit() is actually called) so
// that simply importing this module — which the engine does on every run
// via github-feedback — doesn't pull in the (heavy) Octokit bundle. This
// keeps the run path lightweight when GitHub isn't configured.
type OctokitInstance = InstanceType<typeof import("octokit").Octokit>;
let _OctokitCtor: (new (opts: { auth: string; request: { fetch: typeof fetch } }) => OctokitInstance) | null = null;
async function loadOctokit(): Promise<new (opts: { auth: string; request: { fetch: typeof fetch } }) => OctokitInstance> {
  if (_OctokitCtor) return _OctokitCtor;
  const mod = await import("octokit");
  _OctokitCtor = mod.Octokit;
  return _OctokitCtor;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubCreds {
  token: string;
  owner: string;
  repo: string;
}

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

/**
 * Map any error thrown by the GitHub client (our GitHubError OR Octokit's
 * RequestError, which has `name === "HttpError"` and a `.status` number)
 * to a { message, status } pair that API routes can turn into an HTTP
 * response. Without this, every Octokit 404/422/403 collapses to 500.
 *
 * Octokit RequestError also exposes `.response.data` (the GitHub error
 * body) — we extract the human-readable message from it when present.
 */
export function mapGitHubError(err: unknown): { message: string; status: number } {
  // Our own typed error.
  if (err instanceof GitHubError) {
    return { message: err.message, status: err.status };
  }
  // Octokit RequestError (name "HttpError", has .status, may have .response.data).
  if (err instanceof Error && "status" in err && typeof (err as { status: unknown }).status === "number") {
    const status = (err as { status: number }).status;
    const resp = (err as { response?: { data?: unknown } }).response;
    let message = err.message;
    if (resp?.data && typeof resp.data === "object") {
      const data = resp.data as { message?: string; errors?: Array<{ message?: string }> };
      if (data.message) message = data.message;
      else if (Array.isArray(data.errors) && data.errors[0]?.message) message = data.errors[0].message;
    }
    return { message, status: status || 500 };
  }
  // Unknown error.
  return {
    message: err instanceof Error ? err.message : String(err),
    status: 500,
  };
}

export interface OpenPR {
  [key: string]: unknown;
  number: number;
  url: string;
  title: string;
  head: string;
  base: string;
  state: "open" | "closed";
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  displayTitle: string;
  status: string; // queued|in_progress|completed
  conclusion: string | null; // success|failure|cancelled|skipped|null
  htmlUrl: string;
  branch: string;
  commitSha: string;
  event: string;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface WorkflowSummary {
  id: number;
  name: string;
  path: string;
  state: string; // active|disabled_manually|disabled_inactivity
}

export interface CheckRunResult {
  id: number;
  url: string;
}

export interface CommitStatusResult {
  id: number;
  url: string;
  state: string;
}

// ---------------------------------------------------------------------------
// Settings decryption (mirrors settings/route.ts + experiments/definitions.ts)
// ---------------------------------------------------------------------------

// Use the shared key helper so the production guard (throw if unset)
// applies here too — not just in settings/route.ts.
const ENCRYPTION_KEY = getSettingsEncryptionKeyString();
const SETTINGS_FILE = path.join(process.cwd(), ".forge-settings.json");

interface StoredSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

function decryptSecret(s: StoredSecret): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY, "base64"),
    Buffer.from(s.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(s.tag, "base64"));
  return (
    decipher.update(s.ciphertext, "base64", "utf8") + decipher.final("utf8")
  );
}

// Cache the parsed settings file (with mtime check) so we don't hit the
// filesystem + decrypt on every single GitHub API call. The settings file
// changes rarely; re-reading only when its mtime moves.
let _settingsCache: { mtime: number; data: { secrets: Record<string, StoredSecret>; plain: Record<string, string> } } | null = null;

function loadSettings(): { secrets: Record<string, StoredSecret>; plain: Record<string, string> } {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      _settingsCache = null;
      return { secrets: {}, plain: {} };
    }
    const stat = fs.statSync(SETTINGS_FILE);
    if (_settingsCache && _settingsCache.mtime === stat.mtimeMs) {
      return _settingsCache.data;
    }
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    _settingsCache = { mtime: stat.mtimeMs, data };
    return data;
  } catch {
    _settingsCache = null;
    return { secrets: {}, plain: {} };
  }
}

function getSetting(key: string): string | null {
  const s = loadSettings();
  if (s.secrets?.[key]) {
    try {
      return decryptSecret(s.secrets[key]);
    } catch {
      return null;
    }
  }
  if (s.plain?.[key]) return s.plain[key];
  return process.env[key] ?? null;
}

/**
 * Return the global GitHub token (Forge settings store or env), without
 * requiring a project / owner / repo. Used for account-level operations
 * such as listing repos for linking (see /api/forge/github/repos).
 */
export function getGlobalGitHubToken(): string | null {
  return getSetting("GITHUB_TOKEN");
}

/**
 * Validate a git branch/ref name against GitHub's rules.
 * Rejects: empty, >255 chars, leading '-', '..', '~', ':', '?', '*',
 * '[', '\', spaces, control chars. Returns an error message or null.
 *
 * (Pre-empts GitHub 422s with cryptic messages by giving the user a
 * clear validation error upfront.)
 */
export function validateBranchName(name: string): string | null {
  if (!name || name.length === 0) return "Branch name is required";
  if (name.length > 255) return "Branch name too long (max 255 chars)";
  if (name.startsWith("-")) return "Branch name cannot start with '-'";
  if (name.includes("..")) return "Branch name cannot contain '..'";
  if (name.includes("~")) return "Branch name cannot contain '~'";
  if (name.includes(":")) return "Branch name cannot contain ':'";
  if (name.includes(" ")) return "Branch name cannot contain spaces";
  if (/[?*\[\\]/.test(name)) return "Branch name cannot contain '?', '*', '[', or '\\'";
  if (/[\x00-\x1f]/.test(name)) return "Branch name cannot contain control characters";
  return null;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse owner + repo from a GitHub URL.
 *   https://github.com/owner/repo.git          -> {owner,repo}
 *   git@github.com:owner/repo.git              -> {owner,repo}
 *   https://github.com/owner/repo              -> {owner,repo}
 * Returns null if not a github URL or malformed.
 */
export function parseOwnerRepoFromUrl(repoUrl: string): { owner: string; repo: string } | null {
  if (!repoUrl) return null;
  // SSH form: git@github.com:owner/repo.git
  const ssh = repoUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  // HTTPS form
  const https = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

// ---------------------------------------------------------------------------
// Credentials resolution
// ---------------------------------------------------------------------------

/**
 * Resolve GitHub credentials for a given project. Reads:
 *   • token  — global GITHUB_TOKEN setting (or env)
 *   • owner/repo — from the project's repoUrl (parsed), falling back to
 *     the global GITHUB_OWNER / GITHUB_REPO settings (backwards-compat
 *     with the experiments lab).
 *
 * Returns null if no token is configured, or if owner/repo can't be
 * resolved from either the project's repoUrl or the global settings.
 */
export async function getProjectCreds(projectId: string): Promise<GitHubCreds | null> {
  const token = getSetting("GITHUB_TOKEN");
  if (!token) return null;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { repoUrl: true, repoProvider: true },
  });

  let owner: string | null = null;
  let repo: string | null = null;

  if (project?.repoUrl) {
    const parsed = parseOwnerRepoFromUrl(project.repoUrl);
    if (parsed) {
      owner = parsed.owner;
      repo = parsed.repo;
    }
  }
  if (!owner) owner = getSetting("GITHUB_OWNER");
  if (!repo) repo = getSetting("GITHUB_REPO");

  if (!owner || !repo) return null;
  return { token, owner, repo };
}

/**
 * Get a cached Octokit instance for a project. Returns null if creds
 * are missing (so callers can no-op gracefully).
 */
export async function getOctokit(projectId: string): Promise<{ octokit: OctokitInstance; creds: GitHubCreds } | null> {
  const creds = await getProjectCreds(projectId);
  if (!creds) return null;
  const OctokitCtor = await loadOctokit();
  const octokit = new OctokitCtor({
    auth: creds.token,
    request: { fetch },
  });
  return { octokit, creds };
}

// ---------------------------------------------------------------------------
// Repo / branch helpers
// ---------------------------------------------------------------------------

export async function getDefaultBranch(
  octokit: OctokitInstance,
  creds: GitHubCreds,
): Promise<string> {
  const { data } = await octokit.rest.repos.get({
    owner: creds.owner,
    repo: creds.repo,
  });
  return data.default_branch;
}

export async function checkWriteAccess(
  octokit: OctokitInstance,
  creds: GitHubCreds,
): Promise<boolean> {
  try {
    const { data } = await octokit.rest.repos.get({
      owner: creds.owner,
      repo: creds.repo,
    });
    return data.permissions?.push === true;
  } catch {
    return false;
  }
}

export async function listBranches(
  octokit: OctokitInstance,
  creds: GitHubCreds,
): Promise<string[]> {
  const { data } = await octokit.rest.repos.listBranches({
    owner: creds.owner,
    repo: creds.repo,
    per_page: 100,
  });
  return data.map((b) => b.name);
}

/**
 * Create a new branch off the HEAD of `base` (defaults to the repo's
 * default branch — read dynamically, NOT hardcoded to 'main').
 */
export async function createBranch(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  name: string,
  base?: string,
): Promise<{ ref: string; sha: string }> {
  const baseBranch = base ?? (await getDefaultBranch(octokit, creds));
  const { data: ref } = await octokit.rest.git.getRef({
    owner: creds.owner,
    repo: creds.repo,
    ref: `heads/${baseBranch}`,
  });
  const sha = ref.object.sha;
  const { data: newRef } = await octokit.rest.git.createRef({
    owner: creds.owner,
    repo: creds.repo,
    ref: `refs/heads/${name}`,
    sha,
  });
  return { ref: newRef.ref, sha };
}

// ---------------------------------------------------------------------------
// Commit via Contents API (per-file, auto-commits)
// ---------------------------------------------------------------------------

export async function commitFileViaContentsApi(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  args: { path: string; content: string; branch: string; message: string },
): Promise<{ commitSha: string; commitUrl: string }> {
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner: creds.owner,
    repo: creds.repo,
    path: args.path,
    message: args.message,
    content: Buffer.from(args.content).toString("base64"),
    branch: args.branch,
  });
  return {
    commitSha: data.commit?.sha ?? "",
    commitUrl: data.commit?.html_url ?? "",
  };
}

/**
 * Commit multiple files to a branch (each via Contents API) and return
 * the last commit's sha. For large diffs prefer `git.ts.pushBranch`.
 */
export async function commitFilesViaContentsApi(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  files: Array<{ path: string; content: string }>,
  branch: string,
  message: string,
): Promise<{ lastCommitSha: string | null; commitCount: number }> {
  let lastSha: string | null = null;
  let count = 0;
  for (const file of files) {
    const r = await commitFileViaContentsApi(octokit, creds, {
      path: file.path,
      content: file.content,
      branch,
      message: count === 0 ? message : `${message} (${count + 1}/${files.length})`,
    });
    lastSha = r.commitSha;
    count++;
  }
  return { lastCommitSha: lastSha, commitCount: count };
}

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

export async function createPR(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  args: { title: string; body: string; head: string; base?: string },
): Promise<OpenPR> {
  const base = args.base ?? (await getDefaultBranch(octokit, creds));
  const { data } = await octokit.rest.pulls.create({
    owner: creds.owner,
    repo: creds.repo,
    title: args.title,
    body: args.body,
    head: args.head,
    base,
  });
  return {
    number: data.number,
    url: data.html_url,
    title: data.title,
    head: data.head.ref,
    base: data.base.ref,
    state: data.state as "open" | "closed",
  };
}

export async function listPRs(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  state: "open" | "closed" | "all" = "open",
): Promise<OpenPR[]> {
  const { data } = await octokit.rest.pulls.list({
    owner: creds.owner,
    repo: creds.repo,
    state,
    per_page: 30,
  });
  return data.map((p) => ({
    number: p.number,
    url: p.html_url,
    title: p.title,
    head: p.head.ref,
    base: p.base.ref,
    state: p.state as "open" | "closed",
  }));
}

export async function mergePR(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  number: number,
  method: "merge" | "squash" | "rebase" = "squash",
): Promise<{ sha: string; merged: boolean }> {
  const { data } = await octokit.rest.pulls.merge({
    owner: creds.owner,
    repo: creds.repo,
    pull_number: number,
    merge_method: method,
  });
  return { sha: data.sha, merged: data.merged };
}

export async function createPRReviewComment(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  args: { prNumber: number; body: string; commitSha: string; path?: string; line?: number; side?: "LEFT" | "RIGHT" },
): Promise<{ id: number }> {
  if (args.path && args.line) {
    const { data } = await octokit.rest.pulls.createReviewComment({
      owner: creds.owner,
      repo: creds.repo,
      pull_number: args.prNumber,
      body: args.body,
      commit_id: args.commitSha,
      path: args.path,
      line: args.line,
      side: args.side ?? "RIGHT",
    });
    return { id: data.id };
  }
  // General PR comment (issue comment)
  const { data } = await octokit.rest.issues.createComment({
    owner: creds.owner,
    repo: creds.repo,
    issue_number: args.prNumber,
    body: args.body,
  });
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// GitHub Actions
// ---------------------------------------------------------------------------

export async function listWorkflows(
  octokit: OctokitInstance,
  creds: GitHubCreds,
): Promise<WorkflowSummary[]> {
  const { data } = await octokit.rest.actions.listRepoWorkflows({
    owner: creds.owner,
    repo: creds.repo,
  });
  return (data.workflows ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    path: w.path,
    state: w.state,
  }));
}

export async function listWorkflowRuns(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  limit = 20,
): Promise<WorkflowRunSummary[]> {
  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner: creds.owner,
    repo: creds.repo,
    per_page: limit,
  });
  return (data.workflow_runs ?? []).map((r) => ({
    id: r.id,
    name: r.name ?? "",
    displayTitle: r.display_title ?? "",
    status: r.status ?? "",
    conclusion: r.conclusion,
    htmlUrl: r.html_url,
    branch: r.head_branch ?? "",
    commitSha: r.head_sha,
    event: r.event ?? "",
    startedAt: r.run_started_at ?? null,
    updatedAt: r.updated_at ?? null,
  }));
}

export async function triggerWorkflow(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  args: { workflowId: number | string; ref: string; inputs?: Record<string, string> },
): Promise<void> {
  await octokit.rest.actions.createWorkflowDispatch({
    owner: creds.owner,
    repo: creds.repo,
    workflow_id: args.workflowId,
    ref: args.ref,
    inputs: args.inputs,
  });
}

export async function rerunWorkflowRun(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  runId: number,
): Promise<void> {
  await octokit.rest.actions.reRunWorkflow({
    owner: creds.owner,
    repo: creds.repo,
    run_id: runId,
  });
}

export async function rerunFailedJobs(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  runId: number,
): Promise<void> {
  await octokit.rest.actions.reRunWorkflowFailedJobs({
    owner: creds.owner,
    repo: creds.repo,
    run_id: runId,
  });
}

export async function cancelWorkflowRun(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  runId: number,
): Promise<void> {
  await octokit.rest.actions.cancelWorkflowRun({
    owner: creds.owner,
    repo: creds.repo,
    run_id: runId,
  });
}

/**
 * Download a workflow run's logs. Returns a ReadableStream<Uint8Array>
 * that the caller can pipe straight to an HTTP response — no buffering
 * into RAM. Throws GitHubError if GitHub returns a non-2xx status.
 *
 * (Streaming matters: log ZIPs can be 100+ MB, and buffering them
 * would OOM the server under concurrent downloads.)
 */
export async function downloadWorkflowRunLogs(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  runId: number,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null }> {
  void octokit; // creds+token used directly; octokit kept for API consistency
  const url = `https://api.github.com/repos/${creds.owner}/${creds.repo}/actions/runs/${runId}/logs`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${creds.token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!resp.ok) {
    throw new GitHubError(`Failed to download logs (${resp.status})`, resp.status);
  }
  if (!resp.body) {
    throw new GitHubError("GitHub returned no log body", 502);
  }
  const size = resp.headers.get("content-length");
  return {
    stream: resp.body as ReadableStream<Uint8Array>,
    size: size ? parseInt(size, 10) : null,
  };
}

// ---------------------------------------------------------------------------
// Check Runs + Commit Status (Forge ← GitHub feedback loop)
// ---------------------------------------------------------------------------

export async function createCheckRun(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  args: {
    name: string;
    headSha: string;
    status: "queued" | "in_progress" | "completed";
    conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required";
    detailsUrl?: string;
    externalId?: string;
    output?: { title: string; summary: string; annotations?: Array<{ path: string; start_line: number; end_line: number; annotation_level: "notice" | "warning" | "failure"; message: string }> };
  },
): Promise<CheckRunResult> {
  const { data } = await octokit.rest.checks.create({
    owner: creds.owner,
    repo: creds.repo,
    name: args.name,
    head_sha: args.headSha,
    status: args.status,
    conclusion: args.conclusion,
    details_url: args.detailsUrl,
    external_id: args.externalId,
    output: args.output,
  });
  return { id: data.id, url: data.html_url ?? "" };
}

export async function updateCheckRun(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  args: {
    checkRunId: number;
    status: "queued" | "in_progress" | "completed";
    conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required";
    output?: { title: string; summary: string; annotations?: Array<{ path: string; start_line: number; end_line: number; annotation_level: "notice" | "warning" | "failure"; message: string }> };
  },
): Promise<CheckRunResult> {
  const { data } = await octokit.rest.checks.update({
    owner: creds.owner,
    repo: creds.repo,
    check_run_id: args.checkRunId,
    status: args.status,
    conclusion: args.conclusion,
    output: args.output,
  });
  return { id: data.id, url: data.html_url ?? "" };
}

export async function createCommitStatus(
  octokit: OctokitInstance,
  creds: GitHubCreds,
  args: {
    sha: string;
    state: "pending" | "success" | "failure" | "error";
    context: string;
    description: string;
    targetUrl?: string;
  },
): Promise<CommitStatusResult> {
  const { data } = await octokit.rest.repos.createCommitStatus({
    owner: creds.owner,
    repo: creds.repo,
    sha: args.sha,
    state: args.state,
    context: args.context,
    description: args.description,
    target_url: args.targetUrl,
  });
  return { id: data.id, url: data.url, state: data.state };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (GitHub standard: x-hub-signature-256)
// ---------------------------------------------------------------------------

/**
 * Verify a GitHub webhook signature. GitHub sends `x-hub-signature-256`
 * as `sha256=<hex>`. Constant-time comparison.
 */
export function verifyGitHubWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  const payloadBuf = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const expected = crypto.createHmac("sha256", secret).update(payloadBuf).digest("hex");
  const sig = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const expectedBuf = Buffer.from(expected, "hex");
  const sigBuf = Buffer.from(sig, "hex");
  if (expectedBuf.length !== sigBuf.length || sigBuf.length === 0) return false;
  try {
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Parse a GitHub webhook payload into a normalized event descriptor.
 * Returns null for events we don't handle.
 */
export interface GitHubWebhookEvent {
  type: string; // push | pull_request | check_run | workflow_run | ...
  ref?: string; // branch ref (push)
  prNumber?: number;
  prAction?: string; // opened | synchronize | closed | reopened
  headSha?: string;
  repoFullName?: string;
  sender?: string;
}

export function parseGitHubWebhookEvent(
  eventType: string,
  body: unknown,
): GitHubWebhookEvent | null {
  const b = body as Record<string, unknown>;
  const repo = b.repository as { full_name?: string } | undefined;
  const sender = b.sender as { login?: string } | undefined;
  const base: GitHubWebhookEvent = {
    type: eventType,
    repoFullName: repo?.full_name,
    sender: sender?.login,
  };
  switch (eventType) {
    case "push":
      return { ...base, ref: b.ref as string | undefined };
    case "pull_request": {
      const pr = b.pull_request as { number?: number; head?: { sha?: string }; action?: string } | undefined;
      return {
        ...base,
        prNumber: pr?.number,
        prAction: pr?.action,
        headSha: pr?.head?.sha,
      };
    }
    case "check_run":
    case "workflow_run": {
      const cr = b[eventType] as { head_sha?: string } | undefined;
      return { ...base, headSha: cr?.head_sha };
    }
    case "ping":
      return { ...base, type: "ping" };
    default:
      return base;
  }
}
