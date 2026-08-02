// ============================================================
// Forge — shared step runner
// ============================================================
// The single primitive for executing a shell (or interpreter) step
// inside a Forge run. Replaces the two ~80%-identical
// implementations that lived in engine.ts:runShellStep and
// custom-workflow.ts:executeStepCommand.
//
// Responsibilities:
//   • spawn the child process with a hardened env
//   • stream stdout/stderr line-by-line (masking secrets)
//   • enforce per-step timeout (SIGTERM → 2 s grace → SIGKILL)
//   • block shell-injection patterns in the command itself
//   • report final exit code
// ============================================================
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { maskSecrets } from "./secrets";

/** Patterns that indicate an attempt to escape the shell sandbox. */
export const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\brm\s+-rf\s+\/(\s|$)/, // rm -rf /
  /:\(\)\s*\{\s*:|:\s*\|\s*:/, // fork bomb
  /\bmkfs\b/, // mkfs
  /\bdd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\//, // dd to a device
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
];

export type StepLanguage = "bash" | "sh" | "node" | "python" | "ruby";

export interface RunStepOptions {
  /** Working directory for the child process. */
  cwd: string;
  /** Command (or script body for non-bash languages) to execute. */
  command: string;
  /** Language / interpreter to use. Defaults to "bash". */
  language?: StepLanguage;
  /** Environment variables for the child process. */
  env: Record<string, string>;
  /** Secret values to redact from streamed output. */
  secrets: Record<string, string>;
  /** Per-step timeout in ms. Null = no timeout. */
  timeoutMs?: number | null;
  /** Called for every line of output (already masked). */
  onLine: (stream: "stdout" | "stderr", text: string) => void;
  /** Optional abort signal for cooperative cancellation. */
  signal?: { aborted: boolean };
}

export interface RunStepResult {
  exitCode: number;
  timedOut: boolean;
  canceled: boolean;
}

/**
 * Returns true if the command contains a blocked pattern. The runner
 * refuses to execute any command for which this returns true.
 */
export function isBlockedCommand(command: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(command));
}

function buildInterpreterArgs(
  language: StepLanguage,
  scriptPath: string,
): { cmd: string; args: string[] } | null {
  switch (language) {
    case "bash":
      return { cmd: "bash", args: [scriptPath] };
    case "sh":
      return { cmd: "sh", args: [scriptPath] };
    case "node":
      return { cmd: "node", args: [scriptPath] };
    case "python":
      return { cmd: "python3", args: [scriptPath] };
    case "ruby":
      return { cmd: "ruby", args: [scriptPath] };
    default:
      return null;
  }
}

/**
 * Run a single step. The command is written to a temp file and
 * executed via the chosen interpreter, so multi-line scripts work
 * identically across languages.
 */
export function runChildStep(opts: RunStepOptions): Promise<RunStepResult> {
  return new Promise((resolve) => {
    if (isBlockedCommand(opts.command)) {
      opts.onLine(
        "stderr",
        "[forge] Command blocked by security policy.",
      );
      resolve({ exitCode: 126, timedOut: false, canceled: false });
      return;
    }

    const language = opts.language ?? "bash";
    const interp = buildInterpreterArgs(language, "");
    if (!interp) {
      opts.onLine("stderr", `[forge] Unknown language: ${language}`);
      resolve({ exitCode: 126, timedOut: false, canceled: false });
      return;
    }

    // Write the script body to a temp file so multi-line scripts work
    // uniformly across bash / node / python / ruby.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-step-"));
    const ext =
      language === "node"
        ? ".mjs"
        : language === "python"
          ? ".py"
          : language === "ruby"
            ? ".rb"
            : ".sh";
    const scriptPath = path.join(tmpDir, `step${ext}`);
    fs.writeFileSync(scriptPath, opts.command, { mode: 0o600 });

    const { cmd, args } = buildInterpreterArgs(language, scriptPath)!;
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      opts.onLine(
        "stderr",
        `[forge] Failed to spawn ${cmd}: ${e instanceof Error ? e.message : String(e)}`,
      );
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve({ exitCode: 127, timedOut: false, canceled: false });
      return;
    }

    let timedOut = false;
    let canceled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        killTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, 2000);
      }, opts.timeoutMs);
    }

    // Cooperative cancellation check (every 500 ms).
    const cancelCheck = opts.signal
      ? setInterval(() => {
          if (opts.signal?.aborted) {
            canceled = true;
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
          }
        }, 500)
      : null;

    const stdout = createInterface({ input: child.stdout! });
    const stderr = createInterface({ input: child.stderr! });
    stdout.on("line", (line) =>
      opts.onLine("stdout", maskSecrets(line, opts.secrets)),
    );
    stderr.on("line", (line) =>
      opts.onLine("stderr", maskSecrets(line, opts.secrets)),
    );

    child.on("error", (err) => {
      opts.onLine(
        "stderr",
        `[forge] spawn error: ${err.message}`,
      );
    });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      if (cancelCheck) clearInterval(cancelCheck);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve({
        exitCode: code ?? (canceled ? 143 : 1),
        timedOut,
        canceled,
      });
    });
  });
}

/** Format a byte count as a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const safeI = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(1024, safeI);
  return `${value.toFixed(safeI === 0 ? 0 : 1)} ${units[safeI]}`;
}
