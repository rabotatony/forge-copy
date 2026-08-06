// ============================================================
// Forge — list all projects / create project by upload
// ============================================================
// POST accepts multipart/form-data with a `file` field:
//   .zip / .tar / .tar.gz / .tgz  — archive projects
//   any other file                — single-file static project
// Projects are stored standalone (R2 on Workers / fs elsewhere)
// and are NOT linked to any git remote unless repoUrl is given.
// ============================================================
import type { NextRequest } from "next/server";
import path from "node:path";
import zlib from "node:zlib";
import { db } from "@/lib/db";
import { ok, created, fail, serverError } from "@/lib/forge/response";
import { writeStorageFile } from "@/lib/forge/storage-io";
import { extractDir, sourceZipPath } from "@/lib/forge/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SIZE = 200 * 1024 * 1024; // 200 MB
const MAX_FILES = 20000;

// ---------------------------------------------------------------------------
// Archive extraction (in-memory; works on Workers via nodejs_compat)
// ---------------------------------------------------------------------------

interface Entry {
  path: string;
  data: Uint8Array;
}

function extractZipBuffer(buf: Buffer): Promise<Entry[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yauzl = require("yauzl");
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err: Error | null, zipfile: unknown) => {
      if (err) return reject(err);
      const zf = zipfile as {
        readEntry: () => void;
        on: (ev: string, cb: (...a: never[]) => void) => void;
        openReadStream: (e: unknown, cb: (e: Error | null, s: unknown) => void) => void;
      };
      zf.on("entry", (entry: { fileName: string }) => {
        if (entry.fileName.endsWith("/")) {
          zf.readEntry();
          return;
        }
        zf.openReadStream(entry, (e2, stream) => {
          if (e2) return reject(e2);
          const rs = stream as { on: (ev: string, cb: (c?: Buffer) => void) => void };
          const chunks: Buffer[] = [];
          rs.on("data", (c) => {
            if (c) chunks.push(c);
          });
          rs.on("end", () => {
            entries.push({ path: entry.fileName, data: new Uint8Array(Buffer.concat(chunks)) });
            zf.readEntry();
          });
          rs.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
        });
      });
      zf.on("end", () => resolve(entries));
      zf.on("error", (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))));
      zf.readEntry();
    });
  });
}

function gunzipSync(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buf, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

// Minimal POSIX/ustar tar parser (GNU longname 'L' supported).
function parseTar(buf: Buffer): Entry[] {
  const entries: Entry[] = [];
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
    const sizeStr = header.subarray(124, 136).toString("utf8").replace(/\0+$/, "").trim();
    const typeFlag = String.fromCharCode(header[156]);
    const size = sizeStr ? parseInt(sizeStr, 8) || 0 : 0;
    offset += 512;
    const blocks = Math.ceil(size / 512) * 512;
    if (typeFlag === "L") {
      longName = buf.subarray(offset, offset + size).toString("utf8").replace(/\0+$/, "");
      offset += blocks;
      continue;
    }
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0+$/, "");
    let full = longName ?? name;
    longName = null;
    if (prefix) full = prefix + "/" + full;
    const body = buf.subarray(offset, offset + size);
    offset += blocks;
    if ((typeFlag === "0" || typeFlag === "\0") && full) {
      entries.push({ path: full, data: new Uint8Array(body) });
    }
  }
  return entries;
}

async function extractEntries(fileName: string, buf: Buffer): Promise<Entry[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) {
    return extractZipBuffer(buf);
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return parseTar(await gunzipSync(buf));
  }
  if (lower.endsWith(".tar")) {
    return parseTar(buf);
  }
  return [{ path: fileName || "index.html", data: new Uint8Array(buf) }];
}

// Strip a single common root dir (github tarballs) + block traversal.
function sanitizeEntries(entries: Entry[]): Entry[] | null {
  const clean: Entry[] = [];
  for (const e of entries) {
    const norm = e.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!norm || norm.includes("..")) return null;
    if (path.isAbsolute(norm)) return null;
    clean.push({ path: norm, data: e.data });
  }
  // common single root?
  const roots = new Set(clean.map((e) => e.path.split("/")[0]));
  if (roots.size === 1 && clean.every((e) => e.path.includes("/"))) {
    const root = [...roots][0] + "/";
    return clean
      .map((e) => ({ path: e.path.slice(root.length), data: e.data }))
      .filter((e) => e.path.length > 0);
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Content-based detection (no fs — works from the in-memory entry list)
// ---------------------------------------------------------------------------

function detectFromEntries(entries: Entry[]): { kind: string; detection: Record<string, unknown> } {
  const byPath = new Map<string, Uint8Array>(entries.map((e) => [e.path, e.data]));
  const paths = [...byPath.keys()];
  const hasFile = (p: string) => byPath.has(p);
  const asText = (p: string): string | null => {
    const d = byPath.get(p);
    if (!d) return null;
    try {
      return Buffer.from(d).toString("utf8").slice(0, 300_000);
    } catch {
      return null;
    }
  };
  const asJson = (p: string): Record<string, unknown> | null => {
    const t = asText(p);
    if (!t) return null;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const pkg = asJson("package.json");
  const deps = {
    ...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
  };
  const hasPackageJson = !!pkg;
  const hasLockfile = ["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"].some(hasFile);
  const hasTsConfig = hasFile("tsconfig.json");
  const hasSrcDir = paths.some((p) => p.startsWith("src/"));
  const hasHtmlEntry = hasFile("index.html");
  const hasPrisma = hasFile("prisma/schema.prisma") || !!deps.prisma || !!deps["@prisma/client"];
  const hasDockerfile = hasFile("Dockerfile");
  const hasPyproject = hasFile("pyproject.toml");
  const hasRequirements = hasFile("requirements.txt");

  let framework: string | null = null;
  if (deps.next) framework = "next";
  else if (deps.vite) framework = "vite";
  else if (deps.react && hasHtmlEntry) framework = "react-spa";
  else if (hasPyproject || hasRequirements) framework = "python";

  const hasNextAppApi = paths.some((p) => /^(src\/)?app\/.+\/route\.(ts|js)x?$/.test(p));
  const hasNextPagesApi = paths.some((p) => /^(src\/)?pages\/api\//.test(p));
  const api = hasNextAppApi || hasNextPagesApi;
  const ssr = framework === "next";
  const ssg = framework === "next";
  const spa = !!framework && framework !== "next" && framework !== "python";
  const isStatic = !framework && (hasHtmlEntry || paths.some((p) => p.endsWith(".html")));

  const language =
    hasTsConfig || paths.some((p) => /\.(tsx?|mts|cts)$/.test(p))
      ? "ts"
      : paths.some((p) => /\.(jsx?|mjs|cjs)$/.test(p))
        ? "js"
        : hasPyproject || hasRequirements || paths.some((p) => p.endsWith(".py"))
          ? "python"
          : "unknown";

  const kind =
    hasPyproject || hasRequirements || language === "python"
      ? "python"
      : hasFile("Cargo.toml")
        ? "rust"
        : hasFile("go.mod")
          ? "go"
          : hasPackageJson
            ? "node"
            : "unknown";

  const detection: Record<string, unknown> = {
    framework,
    frameworkVersion: framework === "next" ? (deps.next as string | undefined) ?? null : null,
    hasPackageJson,
    hasLockfile,
    hasSrcDir,
    hasHtmlEntry,
    hasTsConfig,
    hasPrisma,
    hasDockerfile,
    capabilities: { static: isStatic || ssg, ssr, api, spa, ssg },
    warnings: [] as string[],
    language,
  };
  return { kind, detection };
}

// ---------------------------------------------------------------------------
// GET — list all projects
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const projects = await db.project.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    });

    const data = projects.map((p) => {
      const lastRun = p.runs[0];
      return {
        id: p.id,
        name: p.name,
        fileName: p.fileName,
        kind: p.kind,
        fileSize: p.fileSize,
        fileCount: p.fileCount,
        createdAt: p.createdAt.toISOString(),
        runCount: 0, // filled below
        lastRunStatus: lastRun?.status ?? null,
      };
    });

    // Fetch run counts in one round-trip.
    const counts = await db.run.groupBy({
      by: ["projectId"],
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.projectId, c._count._all]));
    for (const d of data) d.runCount = countMap.get(d.id) ?? 0;

    return Response.json({ projects: data });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create project by upload
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail("expected multipart/form-data with a 'file' field");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return fail("missing 'file' field");
    if (file.size === 0) return fail("empty file");
    if (file.size > MAX_SIZE) {
      return fail(`file too large (${(file.size / 1048576).toFixed(1)} MB); limit is 200 MB`);
    }

    const nameField = form.get("name");
    const repoUrlField = form.get("repoUrl");
    const name =
      typeof nameField === "string" && nameField.trim()
        ? nameField.trim()
        : file.name.replace(/\.(zip|tar\.gz|tgz|tar)$/i, "").replace(/\.[a-z0-9]+$/i, "") || "project";
    const repoUrl = typeof repoUrlField === "string" && repoUrlField.trim() ? repoUrlField.trim() : undefined;

    const buf = Buffer.from(await file.arrayBuffer());

    let entries: Entry[];
    try {
      entries = await extractEntries(file.name, buf);
    } catch (e) {
      return fail(`could not extract archive: ${e instanceof Error ? e.message : String(e)}`);
    }
    const clean = sanitizeEntries(entries);
    if (!clean) return fail("archive contains unsafe paths (absolute or ..)");
    if (clean.length === 0) return fail("archive contains no files");
    if (clean.length > MAX_FILES) return fail(`too many files (${clean.length}); limit is ${MAX_FILES}`);

    const { kind, detection } = detectFromEntries(clean);

    const project = await db.project.create({
      data: {
        name,
        fileName: file.name,
        extractedPath: "",
        fileSize: file.size,
        fileCount: clean.length,
        kind,
        detection: JSON.stringify(detection),
        ...(repoUrl ? { repoUrl } : {}),
      },
    });

    try {
      const baseDir = extractDir(project.id);
      // original archive (source.zip or source.tar.gz) for cloud builds
      const lower = file.name.toLowerCase();
      const archivePath = lower.endsWith(".zip")
        ? sourceZipPath(project.id)
        : sourceZipPath(project.id).replace(/source\.zip$/, "source.tar.gz");
      await writeStorageFile(archivePath, buf);
      for (const e of clean) {
        await writeStorageFile(path.posix.join(baseDir, e.path), Buffer.from(e.data));
      }
      await db.project.update({
        where: { id: project.id },
        data: { extractedPath: baseDir },
      });
    } catch (e) {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
      return serverError(new Error(`storage failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    return created({
      id: project.id,
      name: project.name,
      fileName: project.fileName,
      kind,
      fileCount: clean.length,
      detection,
      source: "upload",
    });
  } catch (e) {
    return serverError(e);
  }
}
