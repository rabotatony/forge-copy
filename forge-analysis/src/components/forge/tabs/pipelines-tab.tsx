"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Play, GitBranch, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { usePipelines, useCreatePipeline, useDeletePipeline, useStartPipelineRun, usePipelineRun } from "@/components/forge/use-forge-api-v2";
import { formatRelativeTime, formatDuration } from "@/components/forge/format";
import { StatusBadge } from "@/components/forge/status-badge";

const TEMPLATE = `{
  "stages": [
    {
      "id": "install",
      "name": "Install deps",
      "workflow": "install",
      "needs": []
    },
    {
      "id": "build",
      "name": "Build",
      "workflow": "build",
      "needs": ["install"]
    },
    {
      "id": "test",
      "name": "Test",
      "workflow": "test",
      "needs": ["build"]
    }
  ],
  "config": {
    "concurrentCancellation": true,
    "defaultRetry": 0
  }
}`;

export function PipelinesTab({ projectId, onOpenPipelineRun }: { projectId: string; onOpenPipelineRun: (pipelineRunId: string) => void }) {
  const { data, isLoading } = usePipelines(projectId);
  const createPipeline = useCreatePipeline(projectId);
  const deletePipeline = useDeletePipeline();
  const startRun = useStartPipelineRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(TEMPLATE);
  const [recentRunId, setRecentRunId] = useState<string | null>(null);
  const recentRun = usePipelineRun(recentRunId);

  const handleCreate = async () => {
    try {
      const def = JSON.parse(definition);
      await createPipeline.mutateAsync({ name, definition: def });
      toast.success(`Pipeline "${name}" created`);
      setOpen(false);
      setName("");
      setDefinition(TEMPLATE);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Invalid JSON"); }
  };

  const handleRun = async (pipelineId: string) => {
    try {
      const result = await startRun.mutateAsync({ pipelineId });
      toast.success(`Pipeline run started`);
      setRecentRunId(result.pipelineRunId);
      onOpenPipelineRun(result.pipelineRunId);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const handleDelete = async (pipelineId: string) => {
    try {
      await deletePipeline.mutateAsync(pipelineId);
      toast.success("Pipeline deleted");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 size-4" />Create pipeline</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Create Pipeline</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI pipeline" />
              </div>
              <div className="space-y-1">
                <Label>Definition (JSON)</Label>
                <Textarea value={definition} onChange={(e) => setDefinition(e.target.value)} className="font-mono text-xs min-h-[300px]" />
              </div>
              <Button onClick={handleCreate} disabled={createPipeline.isPending || !name}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-5" />
            Pipelines
            <span className="text-sm font-normal text-muted-foreground">({data?.pipelines.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> :
             data?.pipelines.length === 0 ? <p className="text-sm text-muted-foreground">No pipelines yet. Create one to get started.</p> :
             data?.pipelines.map((p) => {
               let stageCount = 0;
               try { stageCount = (JSON.parse(p.stages) as unknown[]).length; } catch { /* ignore */ }
               return (
                 <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
                   <div className="min-w-0 flex-1">
                     <div className="flex items-center gap-2">
                       <span className="font-medium">{p.name}</span>
                       <Badge variant="outline">{stageCount} stages</Badge>
                     </div>
                     <p className="text-xs text-muted-foreground mt-0.5">created {formatRelativeTime(p.createdAt)}</p>
                   </div>
                   <div className="flex gap-1">
                     <Button variant="outline" size="sm" onClick={() => handleRun(p.id)} disabled={startRun.isPending}>
                       <Play className="mr-1 size-3.5" />Run
                     </Button>
                     <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)} aria-label="Delete">
                       <Trash2 className="size-4 text-destructive" />
                     </Button>
                   </div>
                 </div>
               );
             })}
          </div>
        </CardContent>
      </Card>

      {/* Recent pipeline run */}
      {recentRun.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-5" />
              Latest Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <button
              onClick={() => onOpenPipelineRun(recentRunId!)}
              className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-accent"
            >
              <div className="flex items-center gap-3">
                <StatusBadge status={(recentRun.data as { pipelineRun: { status: "queued" | "running" | "success" | "failed" | "canceled" | "waiting_approval" } }).pipelineRun.status} />
                <div>
                  <p className="font-medium text-sm">{(recentRun.data as { pipelineRun: { id: string } }).pipelineRun.id.slice(0, 12)}…</p>
                  <p className="text-xs text-muted-foreground">
                    {(recentRun.data as { stageRuns: unknown[] }).stageRuns.length} stages
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
