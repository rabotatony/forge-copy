"use client";

import { useState } from "react";
import { FileBox, Download, FileText, FileImage, FileArchive, File, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRun, type RunArtifact } from "./use-forge-api";
import { formatBytes } from "./format";

/**
 * ArtifactsBrowser — browse + preview run artifacts.
 * Shows file-type icons, size, mime type, and inline preview
 * for text/images. Download button per artifact.
 */
export function ArtifactsBrowser({ runId }: { runId: string }) {
  const { data, isLoading } = useRun(runId);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const artifacts: RunArtifact[] = data?.artifacts ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading artifacts…
        </CardContent>
      </Card>
    );
  }

  if (artifacts.length === 0) {
    return null; // Don't show empty state — run view handles that
  }

  const getIcon = (mime: string, name: string) => {
    if (mime.startsWith("image/")) return FileImage;
    if (mime.includes("zip") || mime.includes("archive") || name.endsWith(".zip")) return FileArchive;
    if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml") || name.endsWith(".log") || name.endsWith(".md")) return FileText;
    if (mime.includes("android") || name.endsWith(".apk")) return FileBox;
    return File;
  };

  const isPreviewable = (mime: string, name: string) => {
    return mime.startsWith("text/") ||
      mime.includes("json") ||
      mime.includes("xml") ||
      mime.includes("javascript") ||
      name.endsWith(".log") ||
      name.endsWith(".md") ||
      name.endsWith(".txt") ||
      name.endsWith(".csv");
  };

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileBox className="size-4 text-muted-foreground" />
          Artifacts
          <Badge variant="secondary" className="text-[10px]">{artifacts.length}</Badge>
        </CardTitle>
        <CardDescription>
          Files produced by this run. Click to preview, or download.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Artifact list */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {artifacts.map((a) => {
            const Icon = getIcon(a.mime, a.name);
            const canPreview = isPreviewable(a.mime, a.name);
            const isPreviewing = previewing === a.id;
            return (
              <div
                key={a.id}
                className={cn(
                  "group relative rounded-lg border p-3 transition-all",
                  isPreviewing ? "border-emerald-500/40 bg-emerald-500/[0.03]" : "hover:border-emerald-500/20",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{formatBytes(a.size)}</span>
                      <span>·</span>
                      <span className="truncate font-mono">{a.mime}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-2 flex items-center gap-1.5">
                  {canPreview && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setPreviewing(isPreviewing ? null : a.id)}
                    >
                      <Eye className="size-3" />
                      {isPreviewing ? "Hide" : "Preview"}
                    </Button>
                  )}
                  <a
                    href={`/api/forge/runs/${runId}/artifacts/${a.id}`}
                    download={a.name}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Download className="size-3" />
                    Download
                  </a>
                </div>

                {/* Inline preview */}
                {isPreviewing && canPreview && (
                  <ArtifactPreview runId={runId} artifactId={a.id} name={a.name} />
                )}
              </div>
            );
          })}
        </div>

        {/* Download all */}
        {artifacts.length > 1 && (
          <div className="pt-1">
            <a
              href={`/api/forge/runs/${runId}/logs/download`}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Download className="size-3" />
              Download all logs
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Fetches and displays artifact content inline (text only).
 */
function ArtifactPreview({ runId, artifactId, name }: { runId: string; artifactId: string; name: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch content on mount.
  useState(() => {
    fetch(`/api/forge/runs/${runId}/artifacts/${artifactId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        // Truncate very large previews.
        setContent(text.length > 5000 ? text.slice(0, 5000) + "\n…[truncated]" : text);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      });
  });

  return (
    <div className="mt-2 max-h-64 overflow-y-auto rounded-md border bg-zinc-950 p-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="size-3 animate-spin" />
          Loading preview…
        </div>
      ) : error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
          {content}
        </pre>
      )}
    </div>
  );
}
