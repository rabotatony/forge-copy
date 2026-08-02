"use client";

// ============================================================
// GitImport — clone a remote git repository as a Forge project.
//
// Flow: user enters a git URL (+ optional branch + optional name)
// → POST /api/forge/clone-repo with { url, branch, name } → on
// success the server returns { projectId, name, output } and we
// surface a "Repository cloned!" state with an "Open project" CTA.
//
// Color discipline: emerald accents only. NEVER indigo or blue.
// TypeScript strict: every API response has an explicit interface,
// no `any` anywhere. Uses @tanstack/react-query mutation + sonner
// toast.
// ============================================================

import { useMemo, useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  GitBranch,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Github,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ============================================================
// Types — mirror the Forge API contract.
// ============================================================

interface CloneRepoRequest {
  url: string;
  branch: string;
  name: string;
}

interface CloneRepoResponse {
  projectId: string;
  name: string;
  output?: string;
}

// ============================================================
// Constants
// ============================================================

const EXAMPLE_URLS: ReadonlyArray<{ label: string; url: string }> = [
  { label: "Next.js", url: "https://github.com/vercel/next.js.git" },
  { label: "React", url: "https://github.com/facebook/react.git" },
  { label: "Tailwind", url: "https://github.com/tailwindlabs/tailwindcss.git" },
];

const DEFAULT_BRANCH = "main";

// ============================================================
// Helpers
// ============================================================

// A git URL is either an HTTPS(S) URL or an SSH-style `git@host:owner/repo.git`.
function isValidGitUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("git@")
  );
}

// Derive a sensible project name from the git URL.
// e.g. https://github.com/vercel/next.js.git -> "next.js"
//      git@github.com:facebook/react.git     -> "react"
function deriveNameFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  // Take everything after the last "/" or ":"
  const lastSegment = trimmed.split(/[/:]/).pop() ?? "";
  // Strip an optional ".git" suffix
  return lastSegment.replace(/\.git$/i, "");
}

// ============================================================
// Main component
// ============================================================

export function GitImport({
  onImported,
}: {
  onImported?: (projectId: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  // Track whether the user has manually edited the name field so we
  // don't keep overwriting their input as they type the URL.
  const [nameTouched, setNameTouched] = useState(false);

  // Derived: live validation result for the URL field.
  const urlValid = useMemo(() => isValidGitUrl(url), [url]);

  // Derived: auto-fill the name field from the URL until the user
  // edits it themselves.
  const effectiveName = nameTouched
    ? name
    : deriveNameFromUrl(url);

  // --- Mutation -------------------------------------------------------

  const cloneMutation = useMutation({
    mutationFn: async (req: CloneRepoRequest) => {
      const r = await fetch("/api/forge/clone-repo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Clone failed (${r.status})`);
      }
      return (await r.json()) as CloneRepoResponse;
    },
    onSuccess: (data) => {
      toast.success(`Repository cloned as “${data.name}”`);
      onImported?.(data.projectId);
    },
    onError: (err: Error) => {
      toast.error(`Clone failed: ${err.message || "Unknown error"}`);
    },
  });

  // --- Handlers -------------------------------------------------------

  const handleImport = () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      toast.error("Enter a git repository URL");
      return;
    }
    if (!isValidGitUrl(trimmedUrl)) {
      toast.error(
        "URL must start with http://, https://, or git@",
      );
      return;
    }
    const payload: CloneRepoRequest = {
      url: trimmedUrl,
      branch: branch.trim() || DEFAULT_BRANCH,
      name: (nameTouched ? name.trim() : deriveNameFromUrl(trimmedUrl)) || "",
    };
    cloneMutation.mutate(payload);
  };

  const handleRetry = () => {
    cloneMutation.reset();
    // Immediately retry with the same inputs.
    handleImport();
  };

  const handleExampleClick = (exampleUrl: string) => {
    setUrl(exampleUrl);
    // If the user hasn't manually typed a name, derive it from the new URL.
    if (!nameTouched) setName(deriveNameFromUrl(exampleUrl));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Ctrl/Cmd + Enter triggers the import.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleImport();
    }
  };

  const handleReset = () => {
    cloneMutation.reset();
    setUrl("");
    setBranch("");
    setName("");
    setNameTouched(false);
  };

  // --- Derived render state ------------------------------------------

  const isCloning = cloneMutation.isPending;
  const cloneError = cloneMutation.error;
  const cloneData = cloneMutation.data;
  const isSuccess = !!cloneData && !cloneError;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Github className="size-4 text-emerald-600 dark:text-emerald-400" />
          Import from Git
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Clone a remote git repository as a Forge project. Forge will
          detect its kind and suggest workflows you can run.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Toggle row — switches between "Upload File" and "Import from Git".
            This component renders the Git tab; the parent renders the Upload tab. */}
        <div
          role="tablist"
          aria-label="Project source"
          className="inline-flex w-full items-center rounded-md border border-border bg-muted/30 p-0.5 sm:w-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={false}
            disabled
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors sm:flex-none"
            title="Switch to the Upload tab on the parent surface"
          >
            <Download className="size-3" />
            Upload File
          </button>
          <button
            type="button"
            role="tab"
            aria-selected
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors sm:flex-none"
          >
            <Github className="size-3" />
            Import from Git
          </button>
        </div>

        {/* Form — disabled while cloning / on success. */}
        <fieldset
          disabled={isCloning || isSuccess}
          className="space-y-3.5"
          aria-busy={isCloning}
        >
          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="git-url">Repository URL</Label>
            <Input
              id="git-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://github.com/user/repo.git"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                // Keep name field in sync until the user edits it.
                if (!nameTouched) {
                  setName(deriveNameFromUrl(e.target.value));
                }
              }}
              onKeyDown={handleKeyDown}
              aria-invalid={!urlValid && url.length > 0}
              className={cn(
                "font-mono text-sm",
                urlValid
                  ? "border-emerald-500/20 bg-emerald-500/[0.02] focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/40"
                  : url.length > 0
                    ? "border-red-500/40 focus-visible:ring-red-500/30"
                    : undefined,
              )}
            />
            {url.length > 0 && !urlValid && (
              <p className="text-xs text-red-600 dark:text-red-400">
                URL must start with{" "}
                <code className="font-mono">http://</code>,{" "}
                <code className="font-mono">https://</code>, or{" "}
                <code className="font-mono">git@</code>.
              </p>
            )}

            {/* Example URL chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-muted-foreground">
                Examples:
              </span>
              {EXAMPLE_URLS.map((ex) => (
                <button
                  key={ex.url}
                  type="button"
                  onClick={() => handleExampleClick(ex.url)}
                  disabled={isCloning || isSuccess}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Github className="size-2.5 text-emerald-500" />
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          {/* Branch + Name grid */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="git-branch" className="gap-1.5">
                <GitBranch className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                Branch
                <span className="text-[11px] font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="git-branch"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={DEFAULT_BRANCH}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={handleKeyDown}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="git-name">
                Project name
                <span className="text-[11px] font-normal text-muted-foreground">
                  (auto-derived if empty)
                </span>
              </Label>
              <Input
                id="git-name"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={effectiveName || "my-repo"}
                value={name}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                className="text-sm"
              />
            </div>
          </div>

          {/* Import button */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleImport}
              disabled={isCloning || isSuccess || !urlValid}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              aria-label="Import repository"
            >
              {isCloning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {isCloning ? "Cloning…" : "Import repository"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Ctrl/Cmd + Enter
            </span>
          </div>
        </fieldset>

        {/* Loading state */}
        {isCloning && (
          <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              <span className="font-medium">Cloning repository…</span>
            </div>
            {cloneData?.output ? (
              <pre className="max-h-40 overflow-auto rounded border border-emerald-500/15 bg-zinc-950/80 p-2 font-mono text-[11px] leading-relaxed text-zinc-300 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
                <code>{cloneData.output}</code>
              </pre>
            ) : null}
          </div>
        )}

        {/* Error state */}
        {cloneError && !isCloning && (
          <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
            <div className="flex items-center gap-2">
              <XCircle className="size-4 shrink-0" aria-hidden />
              <span className="font-medium">Clone failed</span>
            </div>
            <p className="break-words text-xs">
              {cloneError instanceof Error
                ? cloneError.message
                : "Something went wrong while cloning the repository."}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetry}
              >
                <Download className="size-3.5" />
                Retry
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => cloneMutation.reset()}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Success state */}
        {isSuccess && cloneData && (
          <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              <span className="font-medium">Repository cloned!</span>
            </div>
            <p className="text-xs">
              Project{" "}
              <span className="font-mono font-medium">
                {cloneData.name}
              </span>{" "}
              is ready.
            </p>
            {cloneData.output ? (
              <pre className="max-h-40 overflow-auto rounded border border-emerald-500/15 bg-zinc-950/80 p-2 font-mono text-[11px] leading-relaxed text-zinc-300 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
                <code>{cloneData.output}</code>
              </pre>
            ) : null}
            <div className="flex items-center gap-2 pt-0.5">
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => onImported?.(cloneData.projectId)}
              >
                Open project
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
              >
                Import another
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
