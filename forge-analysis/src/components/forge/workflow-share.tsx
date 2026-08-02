"use client";

import { useCallback, useRef, useState } from "react";
import { Download, Upload, Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface WorkflowShareProps {
  projectId: string;
  /** If provided, the export button is shown for this specific workflow. */
  workflowId?: string;
}

/**
 * WorkflowShare — export a custom workflow to a downloadable JSON file
 * and import shared workflows back into the project (via paste or file).
 *
 * Accent color is emerald to avoid the forbidden indigo/blue palette.
 */
export function WorkflowShare({ projectId, workflowId }: WorkflowShareProps) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportUrl = workflowId
    ? `/api/forge/projects/${projectId}/custom-workflows/${workflowId}/export`
    : null;

  const handleExport = useCallback(async () => {
    if (!exportUrl) return;
    setExporting(true);
    try {
      const res = await fetch(exportUrl, { method: "GET" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Export failed (${res.status})`);
      }
      // Prefer the server-supplied filename from Content-Disposition.
      const cd = res.headers.get("Content-Disposition") ?? "";
      let filename = "workflow.json";
      const match = /filename="?([^";]+)"?/i.exec(cd);
      if (match && match[1]) filename = match[1];

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Workflow exported as ${filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [exportUrl]);

  const handleFilePicked = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setJsonText(text);
        toast.success(`Loaded ${file.name}`);
      };
      reader.onerror = () => toast.error("Failed to read file");
      void reader.readAsText(file);
    },
    [],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFilePicked(file);
      // reset so picking the same file twice still fires change
      e.target.value = "";
    },
    [handleFilePicked],
  );

  const handleImport = useCallback(async () => {
    if (!jsonText.trim()) {
      toast.error("Paste workflow JSON first");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      toast.error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // Accept either { workflow: { ... } } (export payload) or a bare
    // { name, steps, ... } workflow object.
    let workflow: unknown;
    if (
      typeof parsed === "object" && parsed !== null &&
      "workflow" in (parsed as Record<string, unknown>) &&
      typeof (parsed as { workflow: unknown }).workflow === "object"
    ) {
      workflow = (parsed as { workflow: unknown }).workflow;
    } else {
      workflow = parsed;
    }

    setImporting(true);
    try {
      const res = await fetch(
        `/api/forge/projects/${projectId}/custom-workflows/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Import failed (${res.status})`);
      }
      toast.success("Workflow imported", {
        description: data.id ? `ID: ${data.id}` : undefined,
      });
      setJsonText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [jsonText, projectId]);

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Share2 className="size-4 text-emerald-600" />
          Share Workflow
        </CardTitle>
        <CardDescription>
          Export a custom workflow to a portable JSON file or import one shared with you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Export */}
        {workflowId ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Export
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="size-4 animate-spin text-emerald-600" />
                ) : (
                  <Download className="size-4 text-emerald-600" />
                )}
                Download workflow
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Saves a <code className="font-mono">.json</code> file you can commit or share.
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
            Select a workflow to enable export.
          </div>
        )}

        <div className="h-px bg-border" />

        {/* Import */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Import
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4 text-emerald-600" />
              Choose file…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          <Textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder={'{\n  "workflow": {\n    "name": "my-workflow",\n    "steps": [\n      { "name": "build", "run": "echo building" }\n    ]\n  }\n}'}
            className="min-h-32 font-mono text-xs"
            spellCheck={false}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleImport}
              disabled={importing || !jsonText.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Import
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
