// ============================================================
// Forge — GitHub Actions build engine
// ============================================================
// Runs Forge builds on GitHub's FREE standard runners. Actions is
// free forever for public repositories — real Linux VMs with a real
// filesystem and process spawning, exactly what builds need. Zero
// extra accounts: it uses the GitHub account Forge already has.
//
// Runtime-agnostic by design: plain fetch + env token only (no fs,
// no octokit import) so the same code works on self-hosted Node and
// on Cloudflare Workers (nodejs_compat).
//
// Env:
//   GITHUB_TOKEN / FORGE_GHA_TOKEN  token with Actions write access
//   FORGE_GHA_REPO                  repo hosting forge-remote-build.yml
//                                   (default rabotatony/forge-copy)
//   FORGE_PUBLIC_URL                base URL for runner callbacks
// ============================================================

const API_BASE = "https://api.github.com";
const WORKFLOW_FILE = "forge-remote-build.yml";

export interface DispatchResult {
  dispatched: boolean;
  ghaRunId: number | null;
  runUrl: string | null;
  workflowRepo: string;
}

export function getGhaToken(): string | null {
  return process.env.FORGE_GHA_TOKEN || process.env.GITHUB_TOKEN || null;
}

function workflowRepo(): string {
  return process.env.FORGE_GHA_REPO || "rabotatony/forge-copy";
}

async function gh(pathname: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub API rejects requests without a User-Agent (workerd's fetch
      // does not send one by default).
      "User-Agent": "forge-gha-build",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

function randomTag(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `t-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/**
 * Dispatch forge-remote-build.yml with the project source URL.
 * GitHub has no dispatch correlation id, so we poll briefly to
 * resolve the freshly-created run (matched by inputs.run_id).
 */
export async function dispatchGhaBuild(args: {
  forgeRunId: string;
  sourceUrl: string;
  sourceKind?: "tar" | "zip";
  buildCmd?: string;
  publicUrl?: string;
  token?: string;
  repo?: string;
  ref?: string;
}): Promise<DispatchResult> {
  const token = args.token ?? getGhaToken();
  if (!token) {
    throw new Error("No GitHub token available — set GITHUB_TOKEN (or FORGE_GHA_TOKEN)");
  }
  const repo = args.repo ?? workflowRepo();
  const ref = args.ref ?? "main";

  const callbackToken = process.env.FORGE_GHA_CALLBACK_TOKEN || randomTag();
  const baseUrl = (args.publicUrl ?? process.env.FORGE_PUBLIC_URL ?? "").replace(/\/+$/, "");
  const callbackUrl = baseUrl ? `${baseUrl}/api/forge/gha-build/callback` : "";

  const res = await gh(`/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, token, {
    method: "POST",
    body: JSON.stringify({
      ref,
      inputs: {
        run_id: args.forgeRunId,
        source_url: args.sourceUrl,
        source_kind: args.sourceKind ?? "tar",
        build_cmd: args.buildCmd ?? "",
        callback_url: callbackUrl,
        callback_token: callbackToken,
      },
    }),
  });
  if (res.status !== 204) {
    const body = await res.text();
    throw new Error(`workflow dispatch failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const run = await resolveDispatchedRun(token, repo, args.forgeRunId);
  return {
    dispatched: true,
    ghaRunId: run?.id ?? null,
    runUrl: run?.html_url ?? null,
    workflowRepo: repo,
  };
}

interface MiniRun {
  id: number;
  html_url: string;
  event: string;
}

async function resolveDispatchedRun(
  token: string,
  repo: string,
  forgeRunId: string,
): Promise<{ id: number; html_url: string } | null> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await gh(`/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`, token);
      if (res.status === 200) {
        const data = (await res.json()) as { workflow_runs?: MiniRun[] };
        const dispatched = (data.workflow_runs ?? []).filter((r) => r.event === "workflow_dispatch");
        for (const r of dispatched.slice(0, 3)) {
          const one = await gh(`/repos/${repo}/actions/runs/${r.id}`, token);
          if (one.status === 200) {
            const full = (await one.json()) as { inputs?: Record<string, string> };
            if (full.inputs?.run_id === forgeRunId) return { id: r.id, html_url: r.html_url };
          }
        }
        if (dispatched.length > 0) {
          return { id: dispatched[0].id, html_url: dispatched[0].html_url };
        }
      }
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status / logs / artifacts
// ---------------------------------------------------------------------------

export interface GhaJobInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface GhaRunStatus {
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  jobs: GhaJobInfo[];
}

export async function getGhaRunStatus(runId: number, token?: string): Promise<GhaRunStatus> {
  const tok = token ?? getGhaToken();
  if (!tok) throw new Error("No GitHub token available — set GITHUB_TOKEN (or FORGE_GHA_TOKEN)");
  const repo = workflowRepo();

  const res = await gh(`/repos/${repo}/actions/runs/${runId}`, tok);
  if (res.status !== 200) throw new Error(`run ${runId} not found (${res.status})`);
  const run = (await res.json()) as {
    id: number; status: string; conclusion: string | null; html_url: string; created_at: string;
  };

  const jobsRes = await gh(`/repos/${repo}/actions/runs/${runId}/jobs`, tok);
  let jobs: GhaJobInfo[] = [];
  if (jobsRes.status === 200) {
    const jd = (await jobsRes.json()) as { jobs?: Array<{ id: number; name: string; status: string; conclusion: string | null }> };
    jobs = (jd.jobs ?? []).map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion }));
  }
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    jobs,
  };
}

export async function getGhaJobLogs(jobId: number, token?: string): Promise<string> {
  const tok = token ?? getGhaToken();
  if (!tok) throw new Error("No GitHub token available");
  const res = await gh(`/repos/${workflowRepo()}/actions/jobs/${jobId}/logs`, tok);
  if (res.status !== 200) return "";
  return await res.text();
}

export interface GhaArtifactInfo {
  id: number;
  name: string;
  sizeInBytes: number;
  downloadUrl: string;
}

export async function getGhaArtifacts(runId: number, token?: string): Promise<GhaArtifactInfo[]> {
  const tok = token ?? getGhaToken();
  if (!tok) throw new Error("No GitHub token available");
  const res = await gh(`/repos/${workflowRepo()}/actions/runs/${runId}/artifacts`, tok);
  if (res.status !== 200) return [];
  const data = (await res.json()) as {
    artifacts?: Array<{ id: number; name: string; size_in_bytes: number; archive_download_url: string }>;
  };
  return (data.artifacts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    sizeInBytes: a.size_in_bytes,
    downloadUrl: a.archive_download_url,
  }));
}

// ---------------------------------------------------------------------------
// Signed source tokens — let a free GitHub runner download an uploaded
// project straight from Forge (R2 / fs) without any stored state.
// token = projectId.hmacHex  where hmacHex = HMAC-SHA256(projectId, secret).
// node:crypto only — the same pattern the vault (secrets.ts) already uses
// successfully on Workers (nodejs_compat) and self-hosted Node.
// ---------------------------------------------------------------------------

import * as crypto from "node:crypto";

function sourceSecret(): string {
  return (
    process.env.FORGE_SOURCE_SECRET ||
    process.env.FORGE_GHA_CALLBACK_TOKEN ||
    process.env.FORGE_GHA_TOKEN ||
    process.env.GITHUB_TOKEN ||
    "forge-insecure-source-secret"
  );
}

export function signSourceToken(projectId: string): string {
  const sig = crypto.createHmac("sha256", sourceSecret()).update(projectId).digest("hex");
  return `${projectId}.${sig}`;
}

export function verifySourceToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const projectId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = crypto
    .createHmac("sha256", sourceSecret())
    .update(projectId)
    .digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return crypto.timingSafeEqual(a, b) ? projectId : null;
  } catch {
    return null;
  }
}
