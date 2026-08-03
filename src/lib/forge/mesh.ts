// ============================================================
// Forge Mesh — node registry & task queue core
// ============================================================
// The mesh turns Forge from "runs things locally" into the brain of
// a private cloud assembled from free / scavenged machines.
//
// Design constraints:
//   • Nodes connect OUTBOUND (polling heartbeat) — works behind NAT,
//     CGNAT, mobile data, Termux. No inbound ports required.
//   • Secrets are stored hashed (sha256); plaintext shown once.
//   • Tasks are small JSON payloads; agents execute them and report
//     results back through the same outbound channel.
// ============================================================
import crypto from "node:crypto";
import { db } from "@/lib/db";

export const NODE_KINDS = [
  "generic",
  "vps",
  "termux",
  "koyeb",
  "render",
  "cloudflare",
  "home",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const NODE_CAPABILITIES = ["static", "node", "docker", "tunnel"] as const;

const ONLINE_TTL_MS = 90_000; // ~3 missed heartbeats (agent interval ~20s)

export function generateNodeSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret.trim()).digest("hex");
}

export function safeCompareHash(secret: string, expectedHash: string): boolean {
  try {
    const actual = Buffer.from(hashSecret(secret), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "node"
  );
}

export async function findNodeByIdOrSlug(idOrSlug: string) {
  return db.node.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  });
}

export function nodeStatus(lastSeenAt: Date | null): "online" | "offline" {
  if (!lastSeenAt) return "offline";
  return Date.now() - lastSeenAt.getTime() < ONLINE_TTL_MS ? "online" : "offline";
}

export function normalizeNode(node: Record<string, unknown>) {
  return {
    ...node,
    secretHash: undefined,
    status: nodeStatus(node.lastSeenAt as Date | null),
    capabilities: JSON.parse((node.capabilities as string) || "[]"),
    labels: JSON.parse((node.labels as string) || "{}"),
  };
}

export async function registerNode(input: {
  name: string;
  kind?: string;
  capabilities?: string[];
  labels?: Record<string, unknown>;
}) {
  const kind = NODE_KINDS.includes(input.kind as NodeKind)
    ? (input.kind as string)
    : "generic";
  const base = slugify(input.name);
  let slug = base;
  let n = 2;
  while (await db.node.findUnique({ where: { slug } })) {
    slug = `${base}-${n}`;
    n += 1;
  }
  const secret = generateNodeSecret();
  const node = await db.node.create({
    data: {
      name: input.name.trim().slice(0, 80),
      slug,
      kind,
      secretHash: hashSecret(secret),
      capabilities: JSON.stringify(input.capabilities ?? ["static"]),
      labels: JSON.stringify(input.labels ?? {}),
      status: "offline",
    },
  });
  return { node, secret }; // secret shown exactly once
}

export async function listNodes() {
  const nodes = await db.node.findMany({ orderBy: { createdAt: "desc" } });
  return nodes.map((node) => normalizeNode(node as unknown as Record<string, unknown>));
}

export async function createTask(
  nodeId: string,
  kind: string,
  payload: Record<string, unknown>,
) {
  return db.nodeTask.create({
    data: {
      nodeId,
      kind,
      payload: JSON.stringify(payload),
      status: "pending",
    },
  });
}

export async function claimTasks(nodeId: string, limit = 5) {
  const pending = await db.nodeTask.findMany({
    where: { nodeId, status: "pending" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const claimed = [];
  for (const task of pending) {
    claimed.push(
      await db.nodeTask.update({
        where: { id: task.id },
        data: { status: "running" },
      }),
    );
  }
  return claimed.map((task) => ({
    id: task.id,
    kind: task.kind,
    payload: JSON.parse(task.payload || "{}"),
  }));
}

export async function completeTask(
  taskId: string,
  succeeded: boolean,
  result?: string,
  error?: string,
) {
  return db.nodeTask.update({
    where: { id: taskId },
    data: {
      status: succeeded ? "done" : "failed",
      result: result ?? null,
      error: error ?? null,
    },
  });
}

// Pick a healthy node that satisfies the required capabilities.
export async function selectNode(requiredCaps: string[] = []) {
  const nodes = await listNodes();
  return (
    nodes.find(
      (node) =>
        node.status === "online" &&
        requiredCaps.every((cap) =>
          (node.capabilities as string[]).includes(cap),
        ),
    ) ?? null
  );
}

export function meshSummary(nodes: Array<{ status: string; kind: string }>) {
  return {
    total: nodes.length,
    online: nodes.filter((node) => node.status === "online").length,
    offline: nodes.filter((node) => node.status === "offline").length,
    byKind: nodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.kind] = (acc[node.kind] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
