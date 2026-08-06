// ============================================================
// Forge — project files
// ============================================================
// GET  /api/forge/projects/{id}/files
//      File tree of the extracted project (R2 on Workers, fs local).
// POST /api/forge/projects/{id}/files
//      Batch ingestion (runner -> Forge), token-guarded:
//        { files: [{ path, b64 }] } | { done, paths, keyFiles, fileSize }
// ============================================================
import type { NextRequest } from "next/server";
import path from "node:path";
import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/forge/response";
import { writeStorageFile } from "@/lib/forge/storage-io";
import { extractDir } from "@/lib/forge/storage";
import { verifySourceToken } from "@/lib/forge/gha-build";
import { detectFromManifest } from "@/lib/forge/project-detect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "target",
  ".cache", "coverage", "__pycache__", ".venv", "venv",
]);
const MAX_ENTRIES = 500;
const MAX_BATCH_FILES = 250;
const MAX_BATCH_BYTES = 40 * 1024 * 1024; // decoded bytes

interface TreeNode {
  type: "dir" | "file";
  path: string;
  size: number;
  childrenCount: number;
}

function isWorkersRuntime(): boolean {
  return process.env.FORGE_RUNTIME === "cloudflare";
}

// ---------------------------------------------------------------------------
// GET — file tree
// ---------------------------------------------------------------------------

async function treeFromR2(projectId: string): Promise<{ tree: TreeNode[]; totalFiles: number; truncated: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCloudflareContext } = require("@opennextjs/cloudflare");
  const env = getCloudflareContext().env as Record<string, unknown>;
  const R2 = env.STORAGE as {
    list: (o: { prefix: string; limit: number; cursor?: string }) => Promise<{
      objects: Array<{ key: string; size: number }>;
      truncated: boolean;
      cursor?: string;
    }>;
  };
  const prefix = `projects/${projectId}/extract/`;
  const keys: Array<{ rel: string; size: number }> = [];
  let cursor: string | undefined;
  do {
    const page = await R2.list({ prefix, limit: 1000, cursor });
    for (const o of page.objects) {
      keys.push({ rel: o.key.slice(prefix.length), size: o.size });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && keys.length < 20000);

  const dirs = new Map<string, { count: number; size: number }>();
  const files: TreeNode[] = [];
  let totalFiles = 0;
  for (const k of keys) {
    const first = k.rel.split("/")[0];
    if (SKIP_DIRS.has(first)) continue;
    totalFiles += 1;
    if (k.rel.includes("/")) {
      const d = dirs.get(first) ?? { count: 0, size: 0 };
      d.count += 1;
      d.size += k.size;
      dirs.set(first, d);
    } else {
      files.push({ type: "file", path: k.rel, size: k.size, childrenCount: 0 });
    }
  }
  const tree: TreeNode[] = [
    ...[...dirs.entries()].map(([name, d]) => ({
      type: "dir" as const,
      path: name,
      size: d.size,
      childrenCount: d.count,
    })),
    ...files.sort((a, b) => a.path.localeCompare(b.path)),
  ].slice(0, MAX_ENTRIES);
  return { tree, totalFiles, truncated: totalFiles > MAX_ENTRIES };
}

async function treeFromFs(root: string): Promise<{ tree: TreeNode[]; totalFiles: number; truncated: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const tree: TreeNode[] = [];
  let totalFiles = 0;
  let truncated = false;
  const visit = (dir: string): void => {
    if (truncated) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      if (tree.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) {
        let count = 0;
        try {
          count = fs.readdirSync(full).length;
        } catch {
          count = 0;
        }
        tree.push({ type: "dir", path: rel, size: 0, childrenCount: count });
        visit(full);
      } else {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = 0;
        }
        tree.push({ type: "file", path: rel, size, childrenCount: 0 });
        totalFiles += 1;
      }
    }
  };
  visit(root);
  return { tree, totalFiles, truncated };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    if (isWorkersRuntime()) {
      const res = await treeFromR2(id);
      return Response.json(res);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const root = project.extractedPath;
    if (!root || !fs.existsSync(root)) {
      return Response.json({ tree: [], totalFiles: 0, truncated: false });
    }
    const res = await treeFromFs(root);
    return Response.json(res);
  } catch (e) {
    return serverError(e);
  }
}

// ---------------------------------------------------------------------------
// POST — batch ingestion
// ---------------------------------------------------------------------------

function safePath(p: string): string | null {
  if (typeof p !== "string") return null;
  const norm = p.replace(/\\/g, "/").replace(/^[/]+/, "");
  if (!norm || norm.includes("..") || path.isAbsolute(norm)) return null;
  return norm;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const token = request.headers.get("x-forge-token") ?? "";
    const tokenProject = await verifySourceToken(token);
    if (tokenProject !== id) return fail("bad token", 401);

    // Resilient lookup: findUnique -> findFirst -> short retry.
    let project = await db.project.findUnique({ where: { id } });
    if (!project) project = await db.project.findFirst({ where: { id } });
    if (!project) {
      await new Promise((r) => setTimeout(r, 250));
      project = await db.project.findUnique({ where: { id } });
    }
    if (!project) return fail("project not found", 404);

    const body = (await request.json().catch(() => ({}))) as {
      files?: Array<{ path: string; b64: string }>;
      done?: boolean;
      paths?: string[];
      keyFiles?: Record<string, string>;
      fileSize?: number;
    };

    if (Array.isArray(body.files) && body.files.length > 0) {
      if (body.files.length > MAX_BATCH_FILES) return fail(`batch too large (> ${MAX_BATCH_FILES} files)`);
      const baseDir = extractDir(id);
      let bytes = 0;
      for (const f of body.files) {
        const rel = safePath(f.path);
        if (!rel) return fail(`unsafe path: ${String(f.path).slice(0, 80)}`);
        const data = Buffer.from(f.b64 ?? "", "base64");
        bytes += data.length;
        if (bytes > MAX_BATCH_BYTES) return fail("batch too large (> 40 MB decoded)");
        await writeStorageFile(path.posix.join(baseDir, rel), data);
      }
      return ok({ received: body.files.length });
    }

    if (body.done) {
      const paths = Array.isArray(body.paths)
        ? body.paths.map(safePath).filter((p): p is string => !!p)
        : [];
      const keyFiles = body.keyFiles && typeof body.keyFiles === "object" ? body.keyFiles : {};
      const { kind, detection } = detectFromManifest(paths, keyFiles);
      await db.project.update({
        where: { id },
        data: {
          extractedPath: extractDir(id),
          fileCount: paths.length,
          kind,
          detection: JSON.stringify(detection),
          ...(typeof body.fileSize === "number" ? { fileSize: body.fileSize } : {}),
        },
      });
      return ok({ finalized: true, fileCount: paths.length, kind, framework: detection.framework ?? null });
    }

    return fail("send { files: [...] } or { done: true, paths, keyFiles }");
  } catch (e) {
    return serverError(e);
  }
}
