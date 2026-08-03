// ============================================================
// Forge Mesh — node registry API
// GET  /api/forge/nodes — list nodes + summary
// POST /api/forge/nodes — register a node (returns secret ONCE)
// ============================================================
import { NextRequest } from "next/server";
import { ok, created, fail, serverError } from "@/lib/forge/response";
import { audit } from "@/lib/forge/audit";
import {
  registerNode,
  listNodes,
  meshSummary,
  normalizeNode,
  NODE_KINDS,
} from "@/lib/forge/mesh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const nodes = await listNodes();
    return ok({
      nodes,
      summary: meshSummary(nodes as Array<{ status: string; kind: string }>),
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail("name is required");
    if (name.length > 80) return fail("name too long (max 80)");
    const kind = NODE_KINDS.includes(body.kind) ? body.kind : "generic";
    const capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((c: unknown) => typeof c === "string").slice(0, 8)
      : ["static"];
    const labels =
      body.labels && typeof body.labels === "object" && !Array.isArray(body.labels)
        ? body.labels
        : {};
    const { node, secret } = await registerNode({ name, kind, capabilities, labels });
    await audit("node.register", "node", node.id, "api", { name, kind });
    return created({
      node: normalizeNode(node as unknown as Record<string, unknown>),
      secret,
      bootstrapHint:
        "Run public/mesh/bootstrap-node.sh with FORGE_URL, NODE_SLUG and NODE_SECRET. The secret is shown only once.",
    });
  } catch (e) {
    return serverError(e);
  }
}
