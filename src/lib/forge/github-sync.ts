// ============================================================
// Forge — generic GitHub sync engine (project-agnostic)
// ============================================================
// Any Forge project that has a linked repo (repoUrl) can be synced:
// fetch -> pull -> detect new commits -> (optional) live rebuild.
// This is the bridge that lets an external AI agent (GLM, etc.) keep
// writing to a GitHub repo while Forge mirrors + rebuilds + serves it.
// State lives in <projectDir>/.forge-sync.json (no schema change).
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { projectDir } from "@/lib/forge/storage";
import { isGitRepo, fetchRepo, pullRepo, revParseHead, gitLog } from "@/lib/forge/git";
import { scheduleLiveBuild } from "@/lib/forge/live";
import { audit } from "@/lib/forge/audit";

export interface SyncState {
  lastSyncedSha: string | null;
  lastSyncedAt: string | null;
  lastStatus: "success" | "failure" | null;
  lastMessage: string;
  syncCount: number;
  autoRebuild: boolean;
}

const DEFAULT_SYNC: SyncState = {
  lastSyncedSha: null,
  lastSyncedAt: null,
  lastStatus: null,
  lastMessage: "",
  syncCount: 0,
  autoRebuild: true,
};

function syncPath(projectId: string): string {
  return path.join(projectDir(projectId), ".forge-sync.json");
}

export function getSyncState(projectId: string): SyncState {
  try {
    const raw = fs.readFileSync(syncPath(projectId), "utf8");
    return { ...DEFAULT_SYNC, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SYNC };
  }
}

export function setSyncState(projectId: string, patch: Partial<SyncState>): SyncState {
  const next = { ...getSyncState(projectId), ...patch };
  fs.mkdirSync(projectDir(projectId), { recursive: true });
  fs.writeFileSync(syncPath(projectId), JSON.stringify(next, null, 2));
  return next;
}

export interface SyncResult {
  ok: boolean;
  updated: boolean;
  from: string | null;
  to: string | null;
  newCommits: Array<{ sha: string; author: string; subject: string }>;
  message: string;
}

export async function syncProject(
  projectId: string,
  opts: { rebuild?: boolean } = {},
): Promise<SyncResult> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return { ok: false, updated: false, from: null, to: null, newCommits: [], message: "Project not found" };
  }
  const workspace = project.extractedPath;
  if (!project.repoUrl) {
    return { ok: false, updated: false, from: null, to: null, newCommits: [], message: "Project has no linked repo (repoUrl)" };
  }
  if (!workspace || !fs.existsSync(workspace)) {
    return { ok: false, updated: false, from: null, to: null, newCommits: [], message: "Workspace missing" };
  }
  if (!isGitRepo(workspace)) {
    return { ok: false, updated: false, from: null, to: null, newCommits: [], message: "Workspace is not a git repository" };
  }

  const before = await revParseHead(workspace);

  const fetched = await fetchRepo(workspace, { timeoutMs: 120_000 });
  if (fetched.exitCode !== 0) {
    const msg = (fetched.stderr || "").slice(-300) || "git fetch failed";
    setSyncState(projectId, { lastStatus: "failure", lastMessage: msg, lastSyncedAt: new Date().toISOString() });
    return { ok: false, updated: false, from: before, to: before, newCommits: [], message: msg };
  }

  const pulled = await pullRepo(workspace, { timeoutMs: 120_000 });
  if (pulled.exitCode !== 0) {
    const msg = (pulled.stderr || "").slice(-300) || "git pull failed";
    setSyncState(projectId, { lastStatus: "failure", lastMessage: msg, lastSyncedAt: new Date().toISOString() });
    return { ok: false, updated: false, from: before, to: before, newCommits: [], message: msg };
  }

  const after = await revParseHead(workspace);
  const updated = Boolean(before && after && before !== after);

  const newCommits: Array<{ sha: string; author: string; subject: string }> = [];
  if (updated) {
    const log = await gitLog(workspace, { max: 30 });
    for (const e of log) {
      if (before && e.hash === before) break;
      newCommits.push({ sha: e.hash, author: e.author, subject: e.subject });
    }
  }

  const state = setSyncState(projectId, {
    lastSyncedSha: after,
    lastSyncedAt: new Date().toISOString(),
    lastStatus: "success",
    lastMessage: updated ? `+${newCommits.length} commit(s)` : "up to date",
    syncCount: getSyncState(projectId).syncCount + 1,
  });

  await db.project.update({
    where: { id: projectId },
    data: { lastPulledAt: new Date(), lastFetchAt: new Date() },
  });

  const rebuild = opts.rebuild ?? state.autoRebuild;
  if (updated && rebuild) {
    scheduleLiveBuild(projectId);
  }

  await audit("repo.sync", "project", projectId, "sync", {
    from: before,
    to: after,
    newCommits: newCommits.length,
  });

  return {
    ok: true,
    updated,
    from: before,
    to: after,
    newCommits,
    message: updated ? `Pulled ${newCommits.length} new commit(s)` : "Already up to date",
  };
}

/** Convenience: sync every project that has a linked repo. */
export async function syncAllLinkedProjects(opts: { rebuild?: boolean } = {}): Promise<Array<{ projectId: string; name: string; result: SyncResult }>> {
  const projects = await db.project.findMany({
    where: { repoUrl: { not: null } },
    select: { id: true, name: true, repoUrl: true },
  });
  const out: Array<{ projectId: string; name: string; result: SyncResult }> = [];
  for (const p of projects) {
    if (!p.repoUrl) continue;
    const result = await syncProject(p.id, opts);
    out.push({ projectId: p.id, name: p.name, result });
  }
  return out;
}
