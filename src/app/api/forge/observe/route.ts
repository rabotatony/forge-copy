// ============================================================
// Forge — /observe: the AI's eyes (headless-browser perception)
// ============================================================
// POST /api/forge/observe  { url, mode?, recordMs? }
// Dispatches the Forge Observer (observer/observe.js) to an online
// mesh node with a headless browser. Returns a rich SEMANTIC view:
// accessibility snapshot, console, network, animations/videos.
// This lets the AI "see" dynamic UI (not just a flat screenshot).
// ============================================================
import type { NextRequest } from "next/server";
import { selectNode, createTask } from "@/lib/forge/mesh";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RAW = "https://raw.githubusercontent.com/rabotatony/forge-copy/main/observer/observe.js";

export async function POST(req: NextRequest): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const url = String(b.url ?? "");
  const mode = String(b.mode ?? "semantic");
  if (!url) return Response.json({ error: "url required" }, { status: 400 });

  const node = await selectNode([]);
  if (!node) {
    return Response.json({ error: "No online mesh node with a browser. Join a node (bootstrap-node.sh installs Playwright) to enable observation." }, { status: 501 });
  }

  // Command: ensure playwright, fetch the observer, run it, print JSON.
  const command = `
set -e
cd /tmp
if ! node -e "require('playwright')" >/dev/null 2>&1; then
  npm init -y >/dev/null 2>&1 || true
  npm i playwright >/dev/null 2>&1
  npx playwright install chromium >/dev/null 2>&1 || npx playwright install chromium --with-deps >/dev/null 2>&1
fi
curl -fsSL ${RAW} -o observe.js
node observe.js "${url}" "${mode}" "${Number(b.recordMs ?? 3000)}"
`.trim();

  const task = await createTask((node as any).id, "cmd", { command });
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    const t = await db.nodeTask.findUnique({ where: { id: task.id } });
    if (t && (t.status === "done" || t.status === "failed")) {
      let observation: any = null;
      try {
        const raw = t.result ?? "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) observation = JSON.parse(raw.slice(jsonStart));
      } catch {}
      return Response.json({
        via: "mesh", node: (node as any).slug, status: t.status,
        observation, raw: observation ? undefined : (t.result ?? "").slice(0, 2000), error: t.error,
      });
    }
  }
  return Response.json({ via: "mesh", status: "timeout", taskId: task.id });
}
