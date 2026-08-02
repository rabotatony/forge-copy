"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Sparkles, Send, Loader2, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useProjects, useStartRun } from "./use-forge-api";
import { useRunPreset } from "./use-forge-api";

interface AIResponse {
  action: "navigate" | "run-workflow" | "run-preset" | "answer" | "create-project";
  target?: string;
  projectId?: string;
  workflow?: string;
  presetId?: string;
  text?: string;
}

/**
 * AIAssistant — a natural language command bar.
 * User types what they want, AI maps it to a Forge action.
 *
 * Examples:
 *   "build an apk"     → runs build-apk workflow on the matching project
 *   "show my projects" → navigates home
 *   "how do I add tests?" → AI answers
 *
 * This is the key differentiator from GitHub Actions: no YAML, no config,
 * just tell Forge what you want in plain language.
 */
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  action?: string;
  timestamp: number;
}

export function AIAssistant({
  projectId,
  onNavigate,
  onOpenProject,
  onOpenRun,
  onOpenPipelineRun,
}: {
  projectId?: string;
  onNavigate?: (target: "home" | "upload" | "docs") => void;
  onOpenProject?: (id: string) => void;
  onOpenRun?: (runId: string) => void;
  onOpenPipelineRun?: (pipelineRunId: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<AIResponse | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { data: projectsData } = useProjects();
  const startRun = useStartRun();
  const runPreset = useRunPreset(projectId ?? null);

  // Context-aware suggestions.
  useEffect(() => {
    if (projectId) {
      setSuggestions([
        "Build an APK",
        "Run tests",
        "Security audit",
        "Full CI",
      ]);
    } else {
      setSuggestions([
        "Build an APK",
        "Show my projects",
        "How do I add tests?",
      ]);
    }
  }, [projectId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || loading) return;

    const userMsg = message.trim();
    const userTimestamp = Date.now();
    setLoading(true);
    setLastResponse(null);
    setMessage("");

    // Add user message to history.
    setHistory((prev) => [...prev, { role: "user", text: userMsg, timestamp: userTimestamp }]);

    try {
      const endpoint = projectId
        ? `/api/forge/projects/${projectId}/ai-assistant`
        : "/api/forge/ai-assistant";

      const reqBody = projectId
        ? { message: userMsg }
        : {
            message: userMsg,
            projects: projectsData?.projects.map((p) => ({
              id: p.id,
              name: p.name,
              kind: p.kind,
              fileName: p.fileName,
            })),
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok) {
        throw new Error(`AI request failed: ${res.status}`);
      }

      const data = (await res.json()) as AIResponse;
      setLastResponse(data);

      // Build assistant response text for history.
      let assistantText = data.text ?? "";
      if (data.action === "run-workflow" && data.workflow) {
        assistantText = `Running workflow: ${data.workflow}`;
      } else if (data.action === "run-preset" && data.presetId) {
        assistantText = `Running preset: ${data.presetId}`;
      } else if (data.action === "navigate" && data.target) {
        assistantText = `Navigating to: ${data.target}`;
      }
      setHistory((prev) => [...prev, { role: "assistant", text: assistantText, action: data.action, timestamp: Date.now() }]);

      await executeAction(data);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "unknown error";
      setHistory((prev) => [...prev, { role: "assistant", text: `Error: ${errText}`, timestamp: Date.now() }]);
      toast.error(`AI assistant error: ${errText}`);
    } finally {
      setLoading(false);
    }
  };

  const executeAction = async (data: AIResponse) => {
    switch (data.action) {
      case "navigate": {
        if (data.target && onNavigate) {
          onNavigate(data.target as "home" | "upload" | "docs");
          toast.info(`Navigating to ${data.target}`);
        }
        break;
      }
      case "run-workflow": {
        if (data.workflow) {
          // Priority: AI-returned projectId > prop projectId > first project.
          const targetProjectId = data.projectId ?? projectId ?? projectsData?.projects[0]?.id;
          if (!targetProjectId) {
            toast.error("No project available to run the workflow on. Upload a file first.");
            return;
          }
          try {
            const result = await startRun.mutateAsync({
              projectId: targetProjectId,
              workflow: data.workflow,
            });
            toast.success(`AI started "${data.workflow}" workflow`);
            onOpenRun?.(result.runId);
          } catch (err) {
            toast.error(
              `Failed to run: ${err instanceof Error ? err.message : "unknown"}`,
            );
          }
        }
        break;
      }
      case "run-preset": {
        if (data.presetId && projectId) {
          try {
            const result = await runPreset.mutateAsync(data.presetId);
            toast.success(`AI started preset "${data.presetId}"`);
            if (result.pipelineRunId) {
              onOpenPipelineRun?.(result.pipelineRunId);
            }
          } catch (err) {
            toast.error(
              `Failed to run preset: ${err instanceof Error ? err.message : "unknown"}`,
            );
          }
        }
        break;
      }
      case "answer": {
        // The answer text is displayed in lastResponse, no action needed.
        break;
      }
    }
  };

  const applySuggestion = (s: string) => {
    setMessage(s);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-3">
      {/* Chat history (if any) */}
      {history.length > 0 && (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
          {history.slice(-6).map((msg, idx) => (
            <div
              key={idx}
              className={cn(
                "flex items-start gap-2 text-xs",
                msg.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {msg.role === "assistant" && (
                <Sparkles className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              )}
              <span
                className={cn(
                  "max-w-[80%] rounded-lg px-2.5 py-1.5",
                  msg.role === "user"
                    ? "bg-emerald-600 text-white"
                    : msg.text.startsWith("Error")
                      ? "bg-red-500/10 text-red-700 dark:text-red-300"
                      : "bg-background border border-border",
                )}
              >
                {msg.text}
              </span>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>Forge AI is thinking…</span>
            </div>
          )}
        </div>
      )}

      {/* Chat bar */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-center">
          <div className="pointer-events-none absolute left-3 flex items-center text-emerald-600 dark:text-emerald-400">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              projectId
                ? "Ask Forge AI: 'build an apk', 'run tests'…"
                : "Ask Forge AI: 'build an apk', 'show projects'…"
            }
            disabled={loading}
            className="h-11 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/[0.03] pl-10 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-60"
            aria-label="Ask Forge AI"
          />
          <button
            type="submit"
            disabled={loading || !message.trim()}
            className="absolute right-1.5 flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
            aria-label="Send to AI"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </div>
      </form>

      {/* Suggestions (only when no history) */}
      {history.length === 0 && !loading && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySuggestion(s)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-emerald-500/40 hover:bg-accent hover:text-foreground"
            >
              <Sparkles className="size-2.5 text-emerald-500" />
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Latest AI response (compact summary) */}
      <AnimatePresence mode="wait">
        {lastResponse && !loading && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
              lastResponse.action === "answer"
                ? "border-border bg-muted/30"
                : "border-emerald-500/30 bg-emerald-500/[0.05]",
            )}
          >
            <Sparkles
              className={cn(
                "mt-0.5 size-4 shrink-0",
                lastResponse.action === "answer"
                  ? "text-muted-foreground"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              {lastResponse.text && (
                <p className="leading-relaxed">{lastResponse.text}</p>
              )}
              {lastResponse.action === "run-workflow" && lastResponse.workflow && (
                <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                  <ArrowRight className="size-3.5" />
                  Started: <code className="font-mono">{lastResponse.workflow}</code>
                </p>
              )}
              {lastResponse.action === "run-preset" && lastResponse.presetId && (
                <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                  <ArrowRight className="size-3.5" />
                  Started preset: <code className="font-mono">{lastResponse.presetId}</code>
                </p>
              )}
              {lastResponse.action === "navigate" && lastResponse.target && (
                <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                  <ArrowRight className="size-3.5" />
                  Going to: <code className="font-mono">{lastResponse.target}</code>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
