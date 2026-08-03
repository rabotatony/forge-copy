// ============================================================
// Forge — Cloudflare provider (sovereign)
// ============================================================
// Lets Forge manage Cloudflare directly, with no external CI:
//   * Workers: upload/delete scripts, workers.dev subdomain,
//     routes, custom domains
//   * Pages:   projects (direct-upload publishing lives in cf-pages.ts)
//   * DNS:     zones + records (for custom domains)
//
// Credentials resolve from env (or explicit args):
//   CLOUDFLARE_API_TOKEN   — token with Workers/Pages/DNS edit
//   CLOUDFLARE_ACCOUNT_ID  — target account
// ============================================================

const API = "https://api.cloudflare.com/client/v4";

export interface CfCredentials {
  token: string;
  accountId: string;
}

export interface CfResponse<T = unknown> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

export function getCfCredentials(override?: Partial<CfCredentials>): CfCredentials | null {
  const token = override?.token || process.env.CLOUDFLARE_API_TOKEN || "";
  const accountId = override?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!token || !accountId) return null;
  return { token, accountId };
}

async function cfFetch<T = unknown>(token: string, apiPath: string, init?: RequestInit): Promise<CfResponse<T>> {
  const res = await fetch(`${API}${apiPath}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as CfResponse<T>;
  if (!res.ok || body.success === false) {
    const msg = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// ------------------------------------------------------------
// Workers
// ------------------------------------------------------------
export interface CfWorkerScript { id: string; created_on?: string; modified_on?: string; }

export async function listWorkers(creds: CfCredentials): Promise<CfWorkerScript[]> {
  const r = await cfFetch<CfWorkerScript[]>(creds.token, `/accounts/${creds.accountId}/workers/scripts`);
  return r.result ?? [];
}

export async function uploadWorker(opts: {
  creds: CfCredentials;
  scriptName: string;
  entry: string;
  code: string | Uint8Array;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  assets?: { directory: string; binding?: string };
  vars?: Record<string, string>;
}): Promise<{ id: string }> {
  const { creds, scriptName } = opts;
  const boundary = "----forge" + Math.random().toString(36).slice(2);
  const metadata: Record<string, unknown> = {
    main_module: opts.entry,
    compatibility_date: opts.compatibilityDate ?? "2024-09-23",
    compatibility_flags: opts.compatibilityFlags ?? [],
  };
  if (opts.vars) metadata.vars = opts.vars;
  if (opts.assets) metadata.assets = { ...opts.assets };
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  const push = (s: string | Uint8Array) => parts.push(typeof s === "string" ? enc.encode(s) : s);
  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="metadata"; filename="metadata.json"\r\n`);
  push(`Content-Type: application/json; charset=utf-8\r\n\r\n`);
  push(JSON.stringify(metadata));
  push(`\r\n--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="${opts.entry}"; filename="${opts.entry}"\r\n`);
  push(`Content-Type: application/javascript+module; charset=utf-8\r\n\r\n`);
  push(opts.code);
  push(`\r\n--${boundary}--\r\n`);
  const blob = new Blob(parts as BlobPart[], { type: `multipart/form-data; boundary=${boundary}` });
  const r = await cfFetch<{ id: string }>(creds.token, `/accounts/${creds.accountId}/workers/scripts/${scriptName}`, {
    method: "PUT",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: blob,
  });
  return { id: r.result?.id ?? scriptName };
}

export async function deleteWorker(creds: CfCredentials, scriptName: string): Promise<boolean> {
  await cfFetch(creds.token, `/accounts/${creds.accountId}/workers/scripts/${scriptName}`, { method: "DELETE" });
  return true;
}

export async function getWorkersSubdomain(creds: CfCredentials): Promise<string | null> {
  try {
    const r = await cfFetch<{ subdomain?: string }>(creds.token, `/accounts/${creds.accountId}/workers/subdomain`);
    return r.result?.subdomain ?? null;
  } catch { return null; }
}

export async function ensureWorkersSubdomain(creds: CfCredentials, desired?: string): Promise<string> {
  const existing = await getWorkersSubdomain(creds);
  if (existing) return existing;
  const sub = desired || "forge" + Math.random().toString(36).slice(2, 8);
  await cfFetch(creds.token, `/accounts/${creds.accountId}/workers/subdomain`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subdomain: sub }),
  });
  return sub;
}

export async function workerPublicUrl(creds: CfCredentials, scriptName: string): Promise<string | null> {
  const sub = await getWorkersSubdomain(creds);
  if (!sub) return null;
  return `https://${scriptName}.${sub}.workers.dev`;
}

// ------------------------------------------------------------
// Zones + DNS (needed to attach custom domains)
// ------------------------------------------------------------
export interface CfZone { id: string; name: string; status: string; }
export interface CfDnsRecord {
  id: string; type: string; name: string; content: string;
  proxied?: boolean; ttl?: number;
}

export async function listZones(creds: CfCredentials): Promise<CfZone[]> {
  const r = await cfFetch<CfZone[]>(creds.token, `/zones?account.id=${creds.accountId}&per_page=50`);
  return r.result ?? [];
}

export async function findZoneByName(creds: CfCredentials, name: string): Promise<CfZone | null> {
  const zones = await listZones(creds);
  const target = name.toLowerCase();
  const exact = zones.find((z) => z.name.toLowerCase() === target);
  if (exact) return exact;
  const parent = zones.find((z) => target.endsWith("." + z.name.toLowerCase()));
  return parent ?? null;
}

export async function listDnsRecords(creds: CfCredentials, zoneId: string): Promise<CfDnsRecord[]> {
  const r = await cfFetch<CfDnsRecord[]>(creds.token, `/zones/${zoneId}/dns_records?per_page=100`);
  return r.result ?? [];
}

export async function upsertDnsRecord(opts: {
  creds: CfCredentials;
  zoneId: string;
  type: "A" | "AAAA" | "CNAME";
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
}): Promise<{ id: string }> {
  const { creds, zoneId } = opts;
  const existing = await listDnsRecords(creds, zoneId);
  const match = existing.find((r) => r.type === opts.type && r.name.toLowerCase() === opts.name.toLowerCase());
  const payload = {
    type: opts.type,
    name: opts.name,
    content: opts.content,
    proxied: opts.proxied ?? true,
    ttl: opts.ttl ?? 1,
  };
  if (match) {
    const r = await cfFetch<{ id: string }>(creds.token, `/zones/${zoneId}/dns_records/${match.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return { id: r.result?.id ?? match.id };
  }
  const r = await cfFetch<{ id: string }>(creds.token, `/zones/${zoneId}/dns_records`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  return { id: r.result?.id ?? "" };
}

export async function deleteDnsRecord(creds: CfCredentials, zoneId: string, recordId: string): Promise<boolean> {
  await cfFetch(creds.token, `/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
  return true;
}

// ------------------------------------------------------------
// Worker custom domains
// ------------------------------------------------------------
export interface CfCustomDomain { id: string; hostname: string; }

export async function listWorkerCustomDomains(creds: CfCredentials, scriptName: string): Promise<CfCustomDomain[]> {
  const r = await cfFetch<CfCustomDomain[]>(creds.token,
    `/accounts/${creds.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/domains`);
  return r.result ?? [];
}

export async function attachWorkerCustomDomain(creds: CfCredentials, scriptName: string, hostname: string): Promise<{ id: string }> {
  const r = await cfFetch<{ id: string }>(creds.token,
    `/accounts/${creds.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/domains`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname }),
  });
  return { id: r.result?.id ?? "" };
}

// ------------------------------------------------------------
// Pages (thin wrappers; heavy direct-upload lives in cf-pages.ts)
// ------------------------------------------------------------
export interface CfPagesProject { name: string; subdomain?: string; domains?: Array<{ domain: string }>; }

export async function listPagesProjects(creds: CfCredentials): Promise<CfPagesProject[]> {
  const r = await cfFetch<CfPagesProject[]>(creds.token, `/accounts/${creds.accountId}/pages/projects`);
  return r.result ?? [];
}

export async function ensurePagesProject(creds: CfCredentials, name: string): Promise<void> {
  try {
    await cfFetch(creds.token, `/accounts/${creds.accountId}/pages/projects/${encodeURIComponent(name)}`);
  } catch {
    await cfFetch(creds.token, `/accounts/${creds.accountId}/pages/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, production_branch: "main" }),
    });
  }
}

export async function deletePagesProject(creds: CfCredentials, name: string): Promise<boolean> {
  await cfFetch(creds.token, `/accounts/${creds.accountId}/pages/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
  return true;
}

// ------------------------------------------------------------
// High-level account capability snapshot (for Forge UI)
// ------------------------------------------------------------
export interface CfAccountSummary {
  accountId: string;
  workers: Array<{ id: string }>;
  workersSubdomain: string | null;
  zones: Array<{ id: string; name: string; status: string }>;
  pages: Array<{ name: string; subdomain?: string }>;
}

export async function getAccountSummary(creds: CfCredentials): Promise<CfAccountSummary> {
  const [workers, subdomain, zones, pages] = await Promise.all([
    listWorkers(creds).catch(() => [] as CfWorkerScript[]),
    getWorkersSubdomain(creds),
    listZones(creds).catch(() => [] as CfZone[]),
    listPagesProjects(creds).catch(() => [] as CfPagesProject[]),
  ]);
  return {
    accountId: creds.accountId,
    workers: workers.map((w) => ({ id: w.id })),
    workersSubdomain: subdomain,
    zones: zones.map((z) => ({ id: z.id, name: z.name, status: z.status })),
    pages: pages.map((p) => ({ name: p.name, subdomain: p.subdomain })),
  };
}
