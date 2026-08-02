"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { UploadCloud, FileArchive, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useUploadZip } from "./use-forge-api";
import { formatBytes } from "./format";
import { useTranslation } from "./use-translation";

/**
 * Drag-and-drop ZIP uploader.
 *
 * - Click to browse, or drop a .zip onto the dashed area.
 * - Shows progress bar + file size while uploading.
 * - Calls `onUploaded(projectId)` once the upload completes so the parent
 *   can navigate to the project detail view.
 */
export function ForgeDropzone({
  onUploaded,
}: {
  onUploaded: (projectId: string) => void;
}) {
  const { mutateAsync, isPending, uploadState, isError, error, reset } =
    useUploadZip();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      // Accept any file — Forge will wrap single files into a project,
      // and extract archives (.zip, .tar, .tar.gz, .tgz).
      const file = Array.from(files)[0];
      if (!file) return;
      try {
        const res = await mutateAsync(file);
        onUploaded(res.project.id);
      } catch {
        // error state is exposed by the hook
      }
    },
    [mutateAsync, onUploaded],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const busy = isPending;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload a project file"
      aria-disabled={busy}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={cn(
        "group relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        dragOver
          ? "border-emerald-500/60 bg-emerald-500/5"
          : "border-border hover:border-emerald-500/40 hover:bg-accent/40",
        busy && "pointer-events-none opacity-90",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.tar,.tar.gz,.tgz,.html,.js,.ts,.tsx,.jsx,.css,.json,.py,.go,.rs,.md,.txt,.xml,.svg,.yaml,.yml,application/zip,application/x-zip-compressed,application/x-tar,application/gzip"
        className="sr-only"
        onChange={(e) => {
          void handleFiles(e.target.files);
          // reset value so picking the same file twice re-fires change
          e.target.value = "";
        }}
      />

      {busy ? (
        <>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            {uploadState.progress < 100 ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <FileArchive className="size-5" aria-hidden />
            )}
            <span className="text-sm font-medium">
              {uploadState.progress < 100
                ? "Uploading…"
                : "Extracting & detecting…"}
            </span>
          </div>
          <div className="w-full max-w-sm space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate font-mono">
                {uploadState.fileName ?? "—"}
              </span>
              <span className="ml-2 shrink-0 tabular-nums">
                {uploadState.progress}%
              </span>
            </div>
            <Progress value={uploadState.progress} className="h-2" />
          </div>
        </>
      ) : isError ? (
        <>
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <X className="size-5" aria-hidden />
            <span className="text-sm font-medium">Upload failed</span>
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            {error?.message ?? "Something went wrong. Please try again."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <>
          <div
            className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-transform group-hover:scale-110"
            aria-hidden
          >
            <UploadCloud className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-medium">
              {t("dropzone.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("dropzone.hint")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
