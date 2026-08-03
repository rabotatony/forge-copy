// ============================================================
// Forge — list GitHub repos available for linking (generic)
// GET /api/forge/github/repos?per_page=50&type=all
// Uses the GLOBAL GitHub token (settings store or env), so it is
// not tied to any project. Enables "discover & link any repo".
// ============================================================
import type { NextRequest } from "next/server";
import { getGlobalGitHubToken } from "@/lib/forge/github";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const token = getGlobalGitHubToken();
    if (!token) {
      return Response.json(
        { error: "No GITHUB_TOKEN configured. Set it in Forge settings (GitHub panel) or env." },
        { status: 409 },
      );
    }

    const perPage = Math.min(Number(request.nextUrl.searchParams.get("per_page") ?? 50) || 50, 100);
    const type = request.nextUrl.searchParams.get("type") ?? "all";
    const sort = request.nextUrl.searchParams.get("sort") ?? "pushed";

    // Lazy-load octokit so this route doesn't always pull the heavy bundle.
    const { Octokit } = await import("octokit");
    const octokit = new Octokit({ auth: token, request: { fetch } });

    const res = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: perPage,
      type: type as "all" | "owner" | "member",
      sort: sort as "created" | "updated" | "pushed" | "full_name",
    });

    const repos = res.data.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      private: r.private,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
      defaultBranch: r.default_branch,
      language: r.language,
      pushedAt: r.pushed_at,
      description: r.description,
    }));

    return Response.json({ count: repos.length, repos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
