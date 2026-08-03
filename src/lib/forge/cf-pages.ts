// ============================================================
// Forge — Cloudflare Pages direct-upload publisher
// ============================================================
// Publishes a built directory to Cloudflare Pages with zero
// external CI: walk output -> md5 manifest -> direct-upload
// deployment -> poll until live. Free tier: 500 deploys/month,
// unlimited sites, unlimited bandwidth.
//
// Required credentials (env or explicit):
//   CLOUDFLARE_API_TOKEN   — token with Account/Pages:Edit
//   CLOUDFLARE_ACCOUNT_ID  — target account
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const API = "https://api.cloudflare.com/client/v4";
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB per file

export interface CfCredentials {
  token: string;
  accountId: string;
}

export interface CfPublishOptions {
  projectName: string;
  outDir: string;
  branch?: string;
  pollMs?: number; // default 120s
  log?: (m: string) => void;
}

export interface CfPublishResult {
  ok: boolean;
  url?: string;
  deploymentId?: string;
  projectUrl?: string;
  error?: string;
}

interface CfResponse<T = unknown> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

async function cfFetch<T = unknown>(
  token: string,
  apiPath: string,
  init?: RequestInit,
): Promise<CfResponse<T>> {
  const res = await fetch(`${API}${apiPath}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as CfResponse<T>;
  if (!res.ok || body.success === false) {
    const msg =
      body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

async function ensureCfProject(
  creds: CfCredentials,
  projectName: string,
  log: (m: string) => void,
): Promise<void> {
  try {
    await cfFetch(creds.token, `/accounts/${creds.accountId}/pages/projects/${projectName}`);
  } catch {
    log(`[cf-pages] creating project "${projectName}"`);
    await cfFetch(creds.token, `/accounts/${creds.accountId}/pages/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName, production_branch: "main" }),
    });
  }
}

function walk(
  dir: string,
  base: string,
  files: Array<{ rel: string; full: string }>,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".forge-quarantine") continue;
    const full = path.join(dir, entry.name);
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) walk(full, rel, files);
    else if (entry.isFile()) files.push({ rel, full });
  }
}

export async function publishToCloudflarePages(
  opts: CfPublishOptions,
  creds: CfCredentials,
): Promise<CfPublishResult> {
  const log = opts.log ?? (() => {});
  try {
    await ensureCfProject(creds, opts.projectName, log);

    const files: Array<{ rel: string; full: string }> = [];
    walk(opts.outDir, "", files);
    if (files.length === 0) return { ok: false, error: "output directory is empty" };
    if (files.length > MAX_FILES) {
      return { ok: false, error: `too many files (${files.length} > ${MAX_FILES})` };
    }

    const form = new FormData();
    const manifest: Record<string, string> = {};
    for (const f of files) {
      const size = fs.statSync(f.full).size;
      if (size > MAX_FILE_BYTES) return { ok: false, error: `file too large: ${f.rel}` };
      const buf = fs.readFileSync(f.full);
      const md5 = crypto.createHash("md5").update(buf).digest("hex");
      manifest[f.rel] = md5;
      // Cloudflare expects one part per file, named by md5,
      // with filename carrying the target path.
      form.append(md5, new Blob([buf]), f.rel);
    }
    form.append("manifest", JSON.stringify(manifest));
    form.append("branch", opts.branch ?? "main");

    log(`[cf-pages] uploading ${files.length} files to "${opts.projectName}"`);
    const created = await cfFetch<{ id?: string; url?: string; status?: string }>(
      creds.token,
      `/accounts/${creds.accountId}/pages/projects/${opts.projectName}/deployments`,
      { method: "POST", body: form },
    );
    const depId = created.result?.id;
    let url = created.result?.url;
    let status = created.result?.status ?? "pending";

    const deadline = Date.now() + (opts.pollMs ?? 120_000);
    while (
      depId &&
      Date.now() < deadline &&
      !["success", "failure", "canceled", "error"].includes(status)
    ) {
      await new Promise((r) => setTimeout(r, 3000));
      const cur = await cfFetch<{ status?: string; url?: string }>(
        creds.token,
        `/accounts/${creds.accountId}/pages/projects/${opts.projectName}/deployments/${depId}`,
      );
      status = cur.result?.status ?? status;
      url = cur.result?.url ?? url;
      log(`[cf-pages] deployment status: ${status}`);
    }

    let projectUrl: string | undefined;
    try {
      const proj = await cfFetch<{ subdomain?: string }>(
        creds.token,
        `/accounts/${creds.accountId}/pages/projects/${opts.projectName}`,
      );
      if (proj.result?.subdomain) projectUrl = `https://${proj.result.subdomain}`;
    } catch {
      /* non-fatal */
    }

    if (["failure", "canceled", "error"].includes(status)) {
      return { ok: false, deploymentId: depId, url, projectUrl, error: `deployment ${status}` };
    }
    return {
      ok: status === "success",
      url,
      deploymentId: depId,
      projectUrl,
      error: status === "success" ? undefined : "timed out waiting for deployment",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
