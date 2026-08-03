// ============================================================
// Forge — Artifact Registry (Phase B)
// ============================================================
// Project-level artifact store with provenance, integrity and
// distribution. Turns build outputs into installable/shareable
// products:
//
//   register  — any local file (build output, upload)
//   import    — pull straight from GitHub Actions artifacts or a URL
//   publish   — push to a rolling GitHub Release (free CDN)
//   serve     — streaming download + QR for phone installs
//
// Files live under storage/projects/<projectId>/artifacts/<artifactId>/
// so they live and die with the project directory.
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as dns from "node:dns";
import * as net from "node:net";
import { db } from "@/lib/db";
import { projectDir } from "@/lib/forge/storage";
import { getProjectCreds } from "@/lib/forge/github";

export type ArtifactKind = "file" | "zip" | "apk" | "binary" | "archive";

const MAX_IMPORT_BYTES = 512 * 1024 * 1024; // 512 MB hard cap
const GH_API = "https://api.github.com";

// ------------------------------------------------------------
// Paths
// ------------------------------------------------------------
export function projectArtifactsDir(projectId: string): string {
  const dir = path.join(projectDir(projectId), "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function artifactFileDir(projectId: string, artifactId: string): string {
  const dir = path.join(projectArtifactsDir(projectId), artifactId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
export function sanitizeFileName(name: string): string {
  const base = path
    .basename(name || "artifact")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 180);
  return base || "artifact";
}

export function guessKind(name: string): ArtifactKind {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".apk" || ext === ".aab" || ext === ".ipa") return "apk";
  if (ext === ".zip") return "zip";
  if ([".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"].includes(ext)) return "archive";
  if ([".exe", ".bin", ".sh", ".so", ".dll", ".dmg", ".deb", ".rpm"].includes(ext)) return "binary";
  return "file";
}

export function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".apk") return "application/vnd.android.package-archive";
  if (ext === ".ipa") return "application/octet-stream";
  if (ext === ".zip") return "application/zip";
  if (ext === ".json") return "application/json";
  if (ext === ".html") return "text/html";
  if (ext === ".js") return "text/javascript";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  return "application/octet-stream";
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

// ------------------------------------------------------------
// register — store a local file as a project artifact
// ------------------------------------------------------------
export async function registerArtifact(
  projectId: string,
  opts: {
    filePath: string;
    name?: string;
    runId?: string | null;
    source?: string;
    version?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<{ id: string; name: string; path: string; size: number; kind: string; sha256: string }> {
  if (!fs.existsSync(opts.filePath)) throw new Error(`Source file not found: ${opts.filePath}`);
  const name = sanitizeFileName(opts.name ?? path.basename(opts.filePath));
  const row = await db.artifact.create({
    data: {
      projectId,
      runId: opts.runId ?? null,
      name,
      path: "", // patched below once the id exists
      size: 0,
      mime: guessMime(name),
      kind: guessKind(name),
      version: opts.version ?? null,
      source: opts.source ?? "run",
      meta: JSON.stringify(opts.meta ?? {}),
    },
  });
  const dest = path.join(artifactFileDir(projectId, row.id), name);
  fs.copyFileSync(opts.filePath, dest);
  const size = fs.statSync(dest).size;
  const sha = await sha256File(dest);
  const updated = await db.artifact.update({
    where: { id: row.id },
    data: { path: dest, size, sha256: sha },
  });
  return { id: updated.id, name: updated.name, path: updated.path, size: updated.size, kind: updated.kind, sha256: sha };
}

// ------------------------------------------------------------
// GitHub helpers
// ------------------------------------------------------------
async function ghFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "follow",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(init?.headers ?? {}),
    },
  });
}

export interface WorkflowArtifactInfo {
  apiId: number;
  name: string;
  sizeInBytes: number;
  workflowRunId: number;
  createdAt: string;
  expired: boolean;
}

export async function listWorkflowArtifacts(projectId: string, runId?: number): Promise<WorkflowArtifactInfo[]> {
  const creds = await getProjectCreds(projectId);
  if (!creds) throw new Error("GitHub token not configured (set GITHUB_TOKEN in Settings)");
  const url = runId
    ? `${GH_API}/repos/${creds.owner}/${creds.repo}/actions/runs/${runId}/artifacts?per_page=50`
    : `${GH_API}/repos/${creds.owner}/${creds.repo}/actions/artifacts?per_page=50`;
  const res = await ghFetch(url, creds.token);
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { artifacts?: Array<Record<string, unknown>> };
  return (data.artifacts ?? [])
    .filter((a) => !a.expired)
    .map((a) => ({
      apiId: Number(a.id),
      name: String(a.name ?? "artifact"),
      sizeInBytes: Number(a.size_in_bytes ?? 0),
      workflowRunId: Number(a.workflow_run_id ?? 0),
      createdAt: String(a.created_at ?? ""),
      expired: Boolean(a.expired),
    }));
}

// ------------------------------------------------------------
// ZIP handling (yauzl, already a Forge dependency)
// ------------------------------------------------------------
interface ZipEntryInfo { name: string; size: number }

async function loadYauzl(): Promise<any> {
  const mod: any = await import("yauzl");
  return mod.default ?? mod;
}

function listZipEntries(zipPath: string): Promise<ZipEntryInfo[]> {
  return new Promise((resolve, reject) => {
    loadYauzl().then((yz) => {
      yz.open(zipPath, { lazyEntries: true, autoClose: true }, (err: Error | null, zipfile: any) => {
        if (err) return reject(err);
        const entries: ZipEntryInfo[] = [];
        zipfile.on("entry", (entry: any) => {
          if (!entry.fileName.endsWith("/")) entries.push({ name: entry.fileName, size: entry.uncompressedSize });
          zipfile.readEntry();
        });
        zipfile.on("end", () => resolve(entries));
        zipfile.on("error", reject);
        zipfile.readEntry();
      });
    }).catch(reject);
  });
}

function extractZipEntry(zipPath: string, entryName: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    loadYauzl().then((yz) => {
      yz.open(zipPath, { lazyEntries: true, autoClose: true }, (err: Error | null, zipfile: any) => {
        if (err) return reject(err);
        zipfile.on("entry", (entry: any) => {
          if (entry.fileName === entryName) {
            zipfile.openReadStream(entry, (e2: Error | null, stream: any) => {
              if (e2) return reject(e2);
              const out = fs.createWriteStream(destPath);
              stream.on("end", () => out.close());
              stream.on("error", reject);
              out.on("error", reject);
              out.on("close", () => resolve());
              stream.pipe(out);
            });
          } else {
            zipfile.readEntry();
          }
        });
        zipfile.on("error", reject);
        zipfile.readEntry();
      });
    }).catch(reject);
  });
}

// ------------------------------------------------------------
// import — from GitHub Actions artifacts
// ------------------------------------------------------------
// Downloads the artifact zip; if it wraps a single interesting
// file (apk/aab/ipa, or the largest entry), that file is
// extracted and registered directly — so "shoshana-apk" becomes
// an installable .apk artifact in one click.
export async function importWorkflowArtifact(
  projectId: string,
  opts: { artifactApiId: number; name: string },
): Promise<{ artifactId: string; name: string; extractedFrom?: string }> {
  const creds = await getProjectCreds(projectId);
  if (!creds) throw new Error("GitHub token not configured (set GITHUB_TOKEN in Settings)");
  const url = `${GH_API}/repos/${creds.owner}/${creds.repo}/actions/artifacts/${opts.artifactApiId}/zip`;
  const res = await ghFetch(url, creds.token);
  if (!res.ok) throw new Error(`GitHub artifact download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMPORT_BYTES) throw new Error("Artifact too large (cap 512MB)");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-art-"));
  const zipPath = path.join(tmpDir, `${sanitizeFileName(opts.name)}.zip`);
  fs.writeFileSync(zipPath, buf);
  try {
    const entries = await listZipEntries(zipPath);
    const preferred =
      entries.find((e) => /\.(apk|aab|ipa)$/i.test(e.name)) ??
      entries.find((e) => /\.(zip|tar\.gz|tgz)$/i.test(e.name)) ??
      [...entries].sort((a, b) => b.size - a.size)[0] ??
      null;

    if (preferred && entries.length <= 32 && preferred.size <= MAX_IMPORT_BYTES) {
      const out = path.join(tmpDir, sanitizeFileName(preferred.name));
      await extractZipEntry(zipPath, preferred.name, out);
      const reg = await registerArtifact(projectId, {
        filePath: out,
        name: preferred.name,
        source: "workflow",
        meta: { workflowArtifact: opts.name, artifactApiId: opts.artifactApiId, zipEntries: entries.length },
      });
      return { artifactId: reg.id, name: reg.name, extractedFrom: opts.name };
    }
    const reg = await registerArtifact(projectId, {
      filePath: zipPath,
      name: `${opts.name}.zip`,
      source: "workflow",
      meta: { workflowArtifact: opts.name, artifactApiId: opts.artifactApiId },
    });
    return { artifactId: reg.id, name: reg.name };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------
// import — from URL (SSRF-guarded)
// ------------------------------------------------------------
function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const v6 = ip.toLowerCase();
    return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT
  );
}

export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    throw new Error("Local/internal hosts are not allowed");
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("Private IP addresses are not allowed");
  return u;
}

export async function importFromUrl(
  projectId: string,
  url: string,
  name?: string,
): Promise<{ artifactId: string; name: string }> {
  const u = assertPublicUrl(url);
  if (!net.isIP(u.hostname)) {
    const addresses = await dns.promises.lookup(u.hostname, { all: true });
    for (const a of addresses) {
      if (isPrivateIp(a.address)) throw new Error("URL resolves to a private address");
    }
  }
  const res = await fetch(u.toString(), { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMPORT_BYTES) throw new Error("File too large (cap 512MB)");
  const guessed = name || decodeURIComponent(path.basename(u.pathname)) || "artifact";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-art-"));
  const tmp = path.join(tmpDir, sanitizeFileName(guessed));
  fs.writeFileSync(tmp, buf);
  try {
    const reg = await registerArtifact(projectId, {
      filePath: tmp,
      name: guessed,
      source: "url",
      meta: { url: u.origin + u.pathname },
    });
    return { artifactId: reg.id, name: reg.name };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------
// publish — rolling GitHub Release (free CDN distribution)
// ------------------------------------------------------------
export async function publishToRelease(
  projectId: string,
  artifactId: string,
): Promise<{ releaseUrl: string; assetUrl: string; tag: string }> {
  const creds = await getProjectCreds(projectId);
  if (!creds) throw new Error("GitHub token not configured (set GITHUB_TOKEN in Settings)");
  const art = await db.artifact.findFirst({ where: { id: artifactId, projectId } });
  if (!art) throw new Error("Artifact not found");
  if (!art.path || !fs.existsSync(art.path)) throw new Error("Artifact file missing on disk");

  const tag = "forge-artifacts";
  const base = `${GH_API}/repos/${creds.owner}/${creds.repo}`;

  let releaseId = 0;
  let htmlUrl = "";
  const existing = await ghFetch(`${base}/releases/tags/${tag}`, creds.token);
  if (existing.ok) {
    const j = (await existing.json()) as { id: number; html_url: string };
    releaseId = j.id;
    htmlUrl = j.html_url;
  } else {
    const created = await ghFetch(`${base}/releases`, creds.token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: "Forge Artifacts",
        body: "Rolling artifact release managed by Forge. Assets are replaced in place on every publish.",
        draft: false,
        prerelease: false,
      }),
    });
    if (!created.ok) throw new Error(`Release create failed (${created.status}): ${(await created.text()).slice(0, 200)}`);
    const j = (await created.json()) as { id: number; html_url: string };
    releaseId = j.id;
    htmlUrl = j.html_url;
  }

  const assetName = art.version ? `${art.version}-${art.name}` : art.name;
  const assetsRes = await ghFetch(`${base}/releases/${releaseId}/assets?per_page=100`, creds.token);
  if (assetsRes.ok) {
    const assets = (await assetsRes.json()) as Array<{ id: number; name: string }>;
    for (const a of assets) {
      if (a.name === assetName) {
        await ghFetch(`${base}/releases/assets/${a.id}`, creds.token, { method: "DELETE" });
      }
    }
  }

  const buf = fs.readFileSync(art.path);
  const upload = await fetch(
    `https://uploads.github.com/repos/${creds.owner}/${creds.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/octet-stream" },
      body: buf,
    },
  );
  if (!upload.ok) throw new Error(`Asset upload failed (${upload.status}): ${(await upload.text()).slice(0, 200)}`);
  const asset = (await upload.json()) as { browser_download_url: string };
  return { releaseUrl: htmlUrl, assetUrl: asset.browser_download_url, tag };
}

// ------------------------------------------------------------
// delete — file + row
// ------------------------------------------------------------
export async function deleteArtifact(projectId: string, artifactId: string): Promise<void> {
  const art = await db.artifact.findFirst({ where: { id: artifactId, projectId } });
  if (!art) return;
  fs.rmSync(path.join(projectArtifactsDir(projectId), artifactId), { recursive: true, force: true });
  await db.artifact.delete({ where: { id: artifactId } });
}
