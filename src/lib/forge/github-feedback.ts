// ============================================================
// Forge — GitHub check-runs feedback loop
// ============================================================
// Bridges Forge runs → GitHub check-runs so that every Forge run is
// visible inline on the commit / PR it validated.
//
//   • onRunStart(runId) → reads HEAD sha, creates an `in_progress`
//     check-run, stores checkRunId + headSha on the Run row.
//   • onRunFinish(runId, status) → fetches annotations from the DB,
//     patches the check-run to `completed` with a conclusion + the
//     annotations as GitHub-native inline annotations.
//
// Both calls are best-effort + non-blocking: if GitHub isn't
// configured (no token / not a linked repo), or the API call fails,
// the Forge run proceeds normally. The check-run is purely additive.
// ============================================================

import { db } from "@/lib/db";
import { getOctokit, createCheckRun, updateCheckRun } from "@/lib/forge/github";
import { revParseHead } from "@/lib/forge/git";

const FORGE_BASE_URL = process.env.FORGE_BASE_URL ?? "http://localhost:3000";

/**
 * Called right after a Run row is created (status: running). Creates
 * an `in_progress` GitHub check-run if the project has GitHub creds
 * and a git HEAD. Stores checkRunId + headSha on the Run.
 *
 * Never throws — failures are logged to the run's log stream only.
 */
export async function onRunStart(runId: string): Promise<void> {
  try {
    const run = await db.run.findUnique({
      where: { id: runId },
      select: { projectId: true, workflow: true },
    });
    if (!run) return;
    const gh = await getOctokit(run.projectId);
    if (!gh) return; // GitHub not configured — skip silently.

    const project = await db.project.findUnique({
      where: { id: run.projectId },
      select: { extractedPath: true },
    });
    if (!project?.extractedPath) return;

    const headSha = await revParseHead(project.extractedPath);
    if (!headSha) return;

    const check = await createCheckRun(gh.octokit, gh.creds, {
      name: `Forge · ${run.workflow}`,
      headSha,
      status: "in_progress",
      detailsUrl: `${FORGE_BASE_URL}/?run=${runId}`,
      externalId: runId,
      output: {
        title: `Forge run: ${run.workflow}`,
        summary: `Run [${runId.slice(-8)}](${FORGE_BASE_URL}/?run=${runId}) started.`,
      },
    });

    await db.run.update({
      where: { id: runId },
      data: { checkRunId: check.id, headSha },
    });

    // RACE FIX: if the run reached a terminal state WHILE we were
    // creating the check-run (e.g. the 5s timeout in engine.ts fired,
    // executeRun finished, AND finishRun ran — all before this GitHub
    // API call returned), the check-run is now orphaned `in_progress`
    // because onRunFinish already ran and saw checkRunId=null. Detect
    // that case here and patch the check-run to completed ourselves.
    const postCreate = await db.run.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (
      postCreate &&
      (postCreate.status === "success" ||
        postCreate.status === "failed" ||
        postCreate.status === "canceled")
    ) {
      // Run already finished — patch the check-run we just created.
      await onRunFinish(runId, postCreate.status);
    }
  } catch (err) {
    // Non-fatal — the run must proceed regardless.
    console.warn(`[check-runs] onRunStart(${runId}) failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Called when a Run reaches a terminal state. Patches the GitHub
 * check-run to `completed` with the appropriate conclusion, plus any
 * annotations the workflow recorded (errors/warnings on specific file
 * lines show up inline on GitHub).
 *
 * Never throws — failures are logged only.
 */
export async function onRunFinish(runId: string, status: string): Promise<void> {
  try {
    const run = await db.run.findUnique({
      where: { id: runId },
      select: { projectId: true, checkRunId: true, headSha: true, durationMs: true },
    });
    if (!run || !run.checkRunId) return; // no check-run was created (e.g. no creds / no sha)

    const gh = await getOctokit(run.projectId);
    if (!gh) return;

    // Map Forge status → GitHub conclusion.
    const conclusion =
      status === "success" ? "success"
      : status === "failed" ? "failure"
      : status === "canceled" ? "cancelled"
      : "neutral"; // waiting_approval etc.

    // Fetch annotations recorded during the run.
    const annotations = await db.annotation.findMany({
      where: { runId },
      select: { level: true, message: true, file: true, line: true },
    });

    // Also fetch test report failures and convert them to annotations
    // (so failed tests show up inline on GitHub PRs/commits).
    const testReports = await db.testReport.findMany({
      where: { runId },
      select: { suites: true, failed: true },
    }).catch(() => []);

    const testAnnotations = testReports
      .flatMap((tr) => {
        try {
          const suites = typeof tr.suites === "string" ? JSON.parse(tr.suites) : tr.suites;
          if (!Array.isArray(suites)) return [];
          // Walk the suite tree looking for failed test cases.
          const failures: Array<{ name?: string; message?: string; file?: string; line?: number }> = [];
          const walk = (node: unknown): void => {
            if (!node || typeof node !== "object") return;
            const n = node as Record<string, unknown>;
            if (n.status === "failed" || n.failure) {
              failures.push({
                name: n.name as string | undefined,
                message: (n.failure as string | undefined) || (n.message as string | undefined),
                file: n.file as string | undefined,
                line: n.line as number | undefined,
              });
            }
            if (Array.isArray(n.cases)) n.cases.forEach(walk);
            if (Array.isArray(n.suites)) n.suites.forEach(walk);
            if (Array.isArray(n.tests)) n.tests.forEach(walk);
          };
          suites.forEach(walk);
          return failures.map((f) => ({
            level: "error" as const,
            message: f.message || f.name || "Test failure",
            file: f.file || undefined,
            line: f.line || undefined,
          }));
        } catch { return []; }
      });

    const ghAnnotations: Array<{
      path: string;
      start_line: number;
      end_line: number;
      annotation_level: "failure" | "warning" | "notice";
      message: string;
    }> = [...annotations, ...testAnnotations]
      .filter((a) => a.file && a.line)
      .map((a) => ({
        path: a.file!,
        start_line: a.line!,
        end_line: a.line!,
        annotation_level: (a.level === "error" ? "failure" : a.level === "warning" ? "warning" : "notice") as "failure" | "warning" | "notice",
        message: a.message,
      }));

    const errorCount = [...annotations, ...testAnnotations].filter((a) => a.level === "error").length;
    const warnCount = [...annotations, ...testAnnotations].filter((a) => a.level === "warning").length;
    const durationS = run.durationMs ? (run.durationMs / 1000).toFixed(1) : "?";

    const summary = `Run finished in ${durationS}s — **${status}**.` +
      (errorCount > 0 ? `\n\n❌ ${errorCount} error(s)` : "") +
      (warnCount > 0 ? `\n⚠️ ${warnCount} warning(s)` : "") +
      (errorCount === 0 && warnCount === 0 ? "\n\n✅ No annotations." : "");

    // GitHub limits check-runs to 50 annotations per request. Chunk
    // into batches — the first batch carries status:completed + the
    // summary; subsequent batches append more annotations with the
    // same output (GitHub merges annotations across requests up to the
    // 50-per-request ceiling).
    const CHUNK = 50;
    if (ghAnnotations.length === 0) {
      await updateCheckRun(gh.octokit, gh.creds, {
        checkRunId: run.checkRunId,
        status: "completed",
        conclusion,
        output: { title: `Forge · ${status}`, summary, annotations: undefined },
      });
    } else {
      for (let i = 0; i < ghAnnotations.length; i += CHUNK) {
        const slice = ghAnnotations.slice(i, i + CHUNK);
        await updateCheckRun(gh.octokit, gh.creds, {
          checkRunId: run.checkRunId,
          status: "completed",
          conclusion,
          output: {
            title: `Forge · ${status}`,
            summary,
            annotations: slice,
          },
        });
      }
    }
  } catch (err) {
    console.warn(`[check-runs] onRunFinish(${runId}) failed:`, err instanceof Error ? err.message : err);
  }
}
