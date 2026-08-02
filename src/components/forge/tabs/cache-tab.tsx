"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Database, Scissors } from "lucide-react";
import { toast } from "sonner";
import { useCacheEntries, useDeleteCacheEntry, usePruneCache } from "@/components/forge/use-forge-api";
import { formatBytes, formatRelativeTime } from "@/components/forge/format";

export function CacheTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useCacheEntries(projectId);
  const deleteEntry = useDeleteCacheEntry(projectId);
  const prune = usePruneCache(projectId);
  const [maxEntries, setMaxEntries] = useState("20");

  const totalSize = data?.entries.reduce((sum, e) => sum + e.size, 0) ?? 0;

  const handleDelete = async (key: string) => {
    try {
      await deleteEntry.mutateAsync(key);
      toast.success("Cache entry deleted");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const handlePrune = async () => {
    try {
      const n = parseInt(maxEntries, 10) || 20;
      const result = await prune.mutateAsync(n);
      toast.success(`Removed ${result.removed} cache entries`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-5" />
          Cache
          <span className="text-sm font-normal text-muted-foreground">
            {data?.entries.length ?? 0} entries · {formatBytes(totalSize)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Prune to max entries</label>
            <Input type="number" value={maxEntries} onChange={(e) => setMaxEntries(e.target.value)} className="font-mono text-sm" />
          </div>
          <Button onClick={handlePrune} disabled={prune.isPending} variant="outline">
            <Scissors className="mr-2 size-4" />Prune
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto space-y-1 [&::-webkit-scrollbar]:w-2">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> :
           data?.entries.length === 0 ? <p className="text-sm text-muted-foreground">No cache entries yet. Run a workflow with caching to populate.</p> :
           data?.entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{e.label}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                  <span>{formatBytes(e.size)}</span>
                  <span>{e.hitCount} hits</span>
                  <span>used {formatRelativeTime(e.lastUsedAt)}</span>
                  <span className="font-mono truncate">{e.key.slice(0, 12)}…</span>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(e.key)} aria-label={`Delete ${e.label}`}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
