"use client";

// ============================================================
// ScriptGenerator — AI-powered script authoring surface.
//
// Flow: user describes what they want → POST /api/forge/generate-script
// → preview generated code in a dark terminal block → Save to library
// (POST /api/forge/scripts) → optionally Run now (first save, then
// POST /api/forge/scripts/[id]/run).
//
// Color discipline: emerald accents only. NEVER indigo or blue.
// TypeScript strict: every API response has an explicit interface,
// no `any` anywhere. Uses @tanstack/react-query mutations + sonner
// toasts.
// ============================================================

import { useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles,
  Terminal,
  Play,
  Save,
  Copy,
  Loader2,
  Code2,
  Check,
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
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

// ============================================================
// Types — mirror the Forge API contract.
// ============================================================

type Language = "bash" | "python" | "node";

interface GenerateScriptRequest {
  message: string;
  projectId?: string;
  language: Language;
}

interface GenerateScriptResponse {
  code: string;
  name?: string;
  description?: string;
  language?: Language;
}

interface SaveScriptRequest {
  name: string;
  description?: string;
  language: Language;
  code: string;
  projectId?: string;
}

interface SaveScriptResponse {
  script: {
    id: string;
    name: string;
    language: Language;
    code: string;
  };
}

interface RunScriptResponse {
  runId?: string;
  status?: string;
  message?: string;
}

interface GeneratedState {
  code: string;
  name: string;
  description: string;
}

// ============================================================
// Constants
// ============================================================

const LANGUAGE_OPTIONS: ReadonlyArray<{ value: Language; label: string }> = [
  { value: "bash", label: "Bash" },
  { value: "python", label: "Python" },
  { value: "node", label: "Node" },
];

const SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: "Count TODO comments",
    prompt: "Count all TODO comments in my code",
  },
  {
    label: "Find large files",
    prompt: "Find files larger than 1MB and list them by size",
  },
  {
    label: "Check for console.log",
    prompt: "Find leftover console.log statements in the source tree",
  },
  {
    label: "Generate .gitignore",
    prompt: "Generate a .gitignore for a Node.js project",
  },
];

// ============================================================
// Helpers
// ============================================================

// Derive a sensible default script name from the user's prompt.
function deriveName(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "AI Script";
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 45).trimEnd()}…`;
}

// ============================================================
// Main component
// ============================================================

export function ScriptGenerator({ projectId }: { projectId?: string }) {
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState<Language>("bash");
  const [generated, setGenerated] = useState<GeneratedState | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  // --- Mutations -------------------------------------------------------

  const generateMutation = useMutation({
    mutationFn: async (req: GenerateScriptRequest) => {
      const r = await fetch("/api/forge/generate-script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `AI generation failed (${r.status})`,
        );
      }
      return (await r.json()) as GenerateScriptResponse;
    },
    onSuccess: (data) => {
      setGenerated({
        code: data.code ?? "",
        name: data.name ?? deriveName(message),
        description: data.description ?? message.trim(),
      });
      setSavedId(null);
      toast.success("Script generated");
    },
    onError: (err: Error) => {
      toast.error(`Generation failed: ${err.message || "Unknown error"}`);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (req: SaveScriptRequest) => {
      const r = await fetch("/api/forge/scripts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Save failed (${r.status})`);
      }
      return (await r.json()) as SaveScriptResponse;
    },
    onSuccess: (data) => {
      setSavedId(data.script?.id ?? null);
      toast.success("Saved to script library");
    },
    onError: (err: Error) => {
      toast.error(`Save failed: ${err.message || "Unknown error"}`);
    },
  });

  const runMutation = useMutation({
    mutationFn: async (scriptId: string) => {
      const r = await fetch(`/api/forge/scripts/${scriptId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Run failed (${r.status})`);
      }
      return (await r.json()) as RunScriptResponse;
    },
    onSuccess: (data) => {
      toast.success(data.message ?? "Script run started");
    },
    onError: (err: Error) => {
      toast.error(`Run failed: ${err.message || "Unknown error"}`);
    },
  });

  // --- Handlers --------------------------------------------------------

  const handleGenerate = () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Describe what you want the script to do");
      return;
    }
    generateMutation.mutate({
      message: trimmed,
      projectId,
      language,
    });
  };

  const handleSuggestion = (prompt: string) => {
    setMessage(prompt);
  };

  const handleCopy = async () => {
    if (!generated?.code) return;
    try {
      await navigator.clipboard.writeText(generated.code);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard not available");
    }
  };

  const handleSave = () => {
    if (!generated?.code) return;
    if (savedId) return;
    saveMutation.mutate({
      name: generated.name,
      description: generated.description,
      language,
      code: generated.code,
      projectId,
    });
  };

  // Run now: first save (if not already saved), then run.
  const handleRun = async () => {
    if (!generated?.code) return;
    if (!projectId) {
      toast.error("Select a project to run the script against");
      return;
    }
    try {
      let scriptId = savedId;
      if (!scriptId) {
        const saved = await saveMutation.mutateAsync({
          name: generated.name,
          description: generated.description,
          language,
          code: generated.code,
          projectId,
        });
        scriptId = saved.script?.id ?? null;
        if (scriptId) setSavedId(scriptId);
      }
      if (!scriptId) {
        toast.error("Could not resolve script id from save response");
        return;
      }
      await runMutation.mutateAsync(scriptId);
    } catch {
      // Errors already surfaced via onError handlers above.
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter triggers generation.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleGenerate();
    }
  };

  // --- Derived state ---------------------------------------------------

  const isGenerating = generateMutation.isPending;
  const isSaving = saveMutation.isPending;
  const isRunning = runMutation.isPending;
  const generateError = generateMutation.error;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400" />
          AI Script Generator
          <Badge
            variant="secondary"
            className="ml-1 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
          >
            <Code2 className="size-2.5" />
            Beta
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Describe what you want in plain English. The AI writes the script —
          preview, run, or save it to your library.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Suggestion chips */}
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => handleSuggestion(s.prompt)}
              disabled={isGenerating}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="size-2.5 text-emerald-500" />
              {s.label}
            </button>
          ))}
        </div>

        {/* Input + language selector + Generate */}
        <div className="space-y-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              projectId
                ? "Describe what you want the script to do, e.g. 'count all TODO comments in my code'…  (Ctrl+Enter to generate)"
                : "Describe what you want the script to do, e.g. 'generate a .gitignore for a Node project'…  (Ctrl+Enter to generate)"
            }
            rows={3}
            disabled={isGenerating}
            className="resize-y border-emerald-500/20 bg-emerald-500/[0.02] text-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/40"
            aria-label="Script description"
          />

          <div className="flex flex-wrap items-center gap-2">
            {/* Language selector — radiogroup semantics */}
            <div
              role="radiogroup"
              aria-label="Script language"
              className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5"
            >
              {LANGUAGE_OPTIONS.map((opt) => {
                const active = language === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setLanguage(opt.value)}
                    disabled={isGenerating}
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      active
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Terminal className="size-3" />
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !message.trim()}
              className="ml-auto bg-emerald-600 text-white hover:bg-emerald-700"
              aria-label="Generate script"
            >
              {isGenerating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Generate
            </Button>
          </div>
        </div>

        {/* Loading state */}
        {isGenerating && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
            <Loader2 className="size-4 animate-spin" />
            AI is generating your script…
          </div>
        )}

        {/* Error state */}
        {generateError && !isGenerating && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
            {generateError instanceof Error
              ? generateError.message
              : "Failed to generate script."}
          </div>
        )}

        {/* Preview + action buttons */}
        {generated && !isGenerating && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Code2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="max-w-[60%] truncate font-mono">
                {generated.name}
              </span>
              <Badge
                variant="outline"
                className="border-emerald-500/30 text-[10px] text-emerald-700 dark:text-emerald-300"
              >
                {language}
              </Badge>
              {savedId && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 text-[10px] text-emerald-700 dark:text-emerald-300"
                >
                  <Check className="size-2.5" />
                  Saved
                </Badge>
              )}
            </div>

            <div className="relative">
              <pre className="max-h-80 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
                <code>{generated.code}</code>
              </pre>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCopy}
                disabled={!generated.code}
              >
                {copied ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleSave}
                disabled={isSaving || !generated.code || !!savedId}
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : savedId ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <Save className="size-4" />
                )}
                {savedId ? "Saved" : "Save to library"}
              </Button>

              {projectId && (
                <Button
                  type="button"
                  onClick={handleRun}
                  disabled={
                    isRunning || isSaving || !generated.code
                  }
                  className="ml-auto bg-emerald-600 text-white hover:bg-emerald-700"
                  aria-label="Run script now"
                >
                  {isRunning ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  Run now
                </Button>
              )}
            </div>

            {isRunning && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Running script on project…
              </div>
            )}
            {isSaving && !isRunning && !savedId && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Saving script to library…
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
