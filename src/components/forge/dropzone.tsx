"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { UploadCloud, FileArchive, Loader2, X, FolderUp, Files } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useUploadFiles } from "./use-forge-api";
import { useTranslation } from "./use-translation";

export function ForgeDropzone({ onUploaded }: { onUploaded: (projectId: string) => void }) {
  const { mutateAsync, isPending, uploadState, isError, error, reset } = useUploadFiles();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    try { const res = await mutateAsync(arr); onUploaded(res.project.id); } catch {}
  }, [mutateAsync, onUploaded]);
  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }, [handleFiles]);
  const busy = isPending;
  return (
    <div role="button" tabIndex={0} aria-label="Upload project files" aria-disabled={busy}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); inputRef.current?.click(); } }}
      onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      className={cn("group relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-8",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        dragOver ? "border-emerald-500/60 bg-emerald-500/5" : "border-border hover:border-emerald-500/40 hover:bg-accent/40",
        busy && "pointer-events-none opacity-90")}>
      <input ref={inputRef} type="file" multiple accept=".zip,.tar,.tar.gz,.tgz,.html,.js,.ts,.tsx,.jsx,.css,.json,.py,.go,.rs,.md,.txt,.xml,.svg,.yaml,.yml,application/zip,application/x-zip-compressed,application/x-tar,application/gzip" className="sr-only"
        onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} />
      <input ref={folderInputRef} type="file" multiple
        // @ts-expect-error webkitdirectory
        webkitdirectory="" directory="" className="sr-only"
        onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} />
      {busy ? (
        <>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            {uploadState.progress < 100 ? <Loader2 className="size-5 animate-spin" /> : <FileArchive className="size-5" />}
            <span className="text-sm font-medium">{uploadState.progress < 100 ? "Uploading…" : "Extracting & detecting…"}</span>
          </div>
          <div className="w-full max-w-sm space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate font-mono">{uploadState.fileName ?? "—"}</span>
              <span className="ml-2 shrink-0 tabular-nums">{uploadState.progress}%</span>
            </div>
            <Progress value={uploadState.progress} className="h-2" />
          </div>
        </>
      ) : isError ? (
        <>
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400"><X className="size-5" /><span className="text-sm font-medium">Upload failed</span></div>
          <p className="max-w-md text-xs text-muted-foreground">{error?.message ?? "Something went wrong."}</p>
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); reset(); }}>Try again</Button>
        </>
      ) : (
        <>
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-transform group-hover:scale-110" aria-hidden><UploadCloud className="size-6" /></div>
          <div className="space-y-1"><p className="text-base font-medium">{t("dropzone.title")}</p><p className="text-xs text-muted-foreground">{t("dropzone.hint")}</p></div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }} className="gap-1.5"><FolderUp className="size-3.5" />Upload folder</Button>
            <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }} className="gap-1.5"><Files className="size-3.5" />Pick files</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">ZIP / TAR archives, multiple files, or a whole folder</p>
        </>
      )}
    </div>
  );
}
