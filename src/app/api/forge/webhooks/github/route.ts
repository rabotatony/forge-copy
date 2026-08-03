// ============================================================
// Forge — GitHub webhook receiver (generic, project-agnostic)
// POST /api/forge/webhooks/github
// On a `push` event, finds every Forge project whose repoUrl matches
// the pushed repo and runs a sync (pull + live rebuild). This is how
// an external agent (GLM, etc.) writing to GitHub drives Forge.
//
// Signature verification: if FORGE_GITHUB_WEBHOOK_SECRET is set, the
// X-Hub-Signature-256 header is validated. When unset the event is
// accepted but flagged (dev convenience; set the secret in production).
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  verifyGitHubWebhookSignature,
  parseGitHubWebhookEvent,
} from "@/lib/forge/github";
import { syncProject } from "@/lib/forge/github-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function matchRepoUrl(repoUrl: string | null, repoFullName: string): boolean {
  if (!repoUrl || !repoFullName) return false;
  const norm = repoUrl.toLowerCase().replace(/\.git$/, "");
  return norm.endsWith(repoFullName.toLowerCase());
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const eventType = request.headers.get("x-github-event") ?? "";
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const raw = await request.text();

    const secret = process.env.FORGE_GITHUB_WEBHOOK_SECRET ?? "";
    let signatureValid = false;
    if (secret) {
      if (!signature) {
        return Response.json({ error: "Missing signature" }, { status: 401 });
      }
      signatureValid = verifyGitHubWebhookSignature(raw, signature, secret);
      if (!signatureValid) {
        return Response.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const event = parseGitHubWebhookEvent(eventType, body);
    if (!event) {
      return Response.json({ ok: true, handled: false, reason: "unhandled event type" });
    }

    if (event.type === "ping") {
      return Response.json({ ok: true, handled: true, event: "ping" });
    }

    if (event.type !== "push") {
      return Response.json({ ok: true, handled: false, reason: "event '" + event.type + "' ignored" });
    }

    const repoFullName = event.repoFullName ?? "";
    if (!repoFullName) {
      return Response.json({ ok: true, handled: false, reason: "no repository in payload" });
    }

    const projects = await db.project.findMany({
      where: { repoUrl: { not: null } },
      select: { id: true, name: true, repoUrl: true },
    });
    const matched = projects.filter((p) => matchRepoUrl(p.repoUrl, repoFullName));

    const results = [];
    for (const p of matched) {
      const result = await syncProject(p.id, {});
      results.push({ projectId: p.id, name: p.name, ok: result.ok, updated: result.updated, message: result.message });
    }

    return Response.json({
      ok: true,
      handled: true,
      event: "push",
      repo: repoFullName,
      headSha: event.headSha ?? null,
      signatureValid: secret ? signatureValid : null,
      matchedProjects: matched.length,
      results,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
