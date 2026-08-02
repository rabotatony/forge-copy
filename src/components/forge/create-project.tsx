"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UploadCloud, GitBranch, Sparkles } from "lucide-react";
import { ForgeDropzone } from "./dropzone";
import { GitImport } from "./git-import";
import { PROJECT_TEMPLATES } from "@/lib/forge/templates-projects";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * CreateProjectDialog — the ONE entry point for creating a new project.
 *
 * Three modes, one dialog:
 *   1. Upload — drop a ZIP / TAR / single file
 *   2. Clone — git URL + branch
 *   3. Template — choose from 6 quick-start project templates
 *
 * Replaces the old projects page that had the dropzone, git import, and
 * script generator all visible at once. Now the projects page is just a
 * clean project grid + a "New Project" button.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectId: string) => void;
}) {
  const [mode, setMode] = useState<"upload" | "clone" | "template">("upload");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            Upload a code archive, clone a git repository, or start from a template.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload" className="gap-1.5">
              <UploadCloud className="size-3.5" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="clone" className="gap-1.5">
              <GitBranch className="size-3.5" />
              Clone
            </TabsTrigger>
            <TabsTrigger value="template" className="gap-1.5">
              <Sparkles className="size-3.5" />
              Template
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
            <ForgeDropzone
              onUploaded={(projectId) => {
                onOpenChange(false);
                onCreated(projectId);
              }}
            />
          </TabsContent>

          <TabsContent value="clone" className="mt-4">
            <GitImport
              onImported={(projectId) => {
                onOpenChange(false);
                onCreated(projectId);
              }}
            />
          </TabsContent>

          <TabsContent value="template" className="mt-4">
            <TemplateGrid
              onCreated={(projectId) => {
                onOpenChange(false);
                onCreated(projectId);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function TemplateGrid({
  onCreated,
}: {
  onCreated: (projectId: string) => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "dev" | "basic">("all");

  const handleCreate = async (templateId: string, name: string) => {
    setLoading(templateId);
    try {
      const res = await fetch("/api/forge/create-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed");
      }
      const data = await res.json();
      toast.success(`Created project from ${name} template`);
      onCreated(data.project.id);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to create from template",
      );
    } finally {
      setLoading(null);
    }
  };

  const filtered = PROJECT_TEMPLATES.filter((t) => {
    if (filter === "all") return true;
    if (filter === "dev") return t.dev === true;
    if (filter === "basic") return t.dev !== true;
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex gap-1.5">
        {[
          { id: "all" as const, label: "All", count: PROJECT_TEMPLATES.length },
          { id: "dev" as const, label: "Dev-grade", count: PROJECT_TEMPLATES.filter(t => t.dev).length },
          { id: "basic" as const, label: "Basic", count: PROJECT_TEMPLATES.filter(t => !t.dev).length },
        ].map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              filter === f.id ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-card/50 text-muted-foreground hover:bg-accent hover:text-foreground")}>
            {f.label}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{f.count}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filtered.map((tpl) => (
          <button key={tpl.id} type="button" disabled={loading !== null} onClick={() => handleCreate(tpl.id, tpl.name)}
            className={cn("group flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-emerald-500/40 hover:bg-accent/40", loading === tpl.id && "opacity-60")}>
            <div className="flex w-full items-center justify-between">
              <span className="text-2xl" aria-hidden>{tpl.emoji}</span>
              {tpl.dev && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">DEV</span>}
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{tpl.name}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{tpl.description}</p>
            </div>
            <span className="mt-auto text-xs font-medium text-emerald-600 dark:text-emerald-400 opacity-0 transition-opacity group-hover:opacity-100">
              {loading === tpl.id ? "Creating…" : "Create →"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
