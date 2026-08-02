"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, Save } from "lucide-react";
import { toast } from "sonner";
import { useProjectSettings, useUpdateSettings } from "@/components/forge/use-forge-api";

export function SettingsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProjectSettings(projectId);
  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading settings...</p>;
  return <SettingsForm key={projectId} projectId={projectId} initial={data as Record<string, unknown>} />;
}

function SettingsForm({ projectId, initial }: { projectId: string; initial: Record<string, unknown> }) {
  const update = useUpdateSettings(projectId);
  const [form, setForm] = useState<Record<string, unknown>>(initial);

  const handleSave = async () => {
    try {
      await update.mutateAsync(form);
      toast.success("Settings saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SettingsIcon className="size-5" />Project Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Concurrent cancellation</Label>
            <p className="text-xs text-muted-foreground">Cancel in-progress runs when a new run starts</p>
          </div>
          <Switch checked={form.concurrentCancellation as boolean} onCheckedChange={(v) => setForm({ ...form, concurrentCancellation: v })} />
        </div>
        <div className="space-y-1">
          <Label>Default retry count</Label>
          <Input type="number" value={String(form.defaultRetry ?? 0)} onChange={(e) => setForm({ ...form, defaultRetry: parseInt(e.target.value, 10) || 0 })} className="font-mono" />
        </div>
        <div className="space-y-1">
          <Label>Default timeout (ms, 0 = no timeout)</Label>
          <Input type="number" value={String(form.defaultTimeoutMs ?? 0)} onChange={(e) => setForm({ ...form, defaultTimeoutMs: parseInt(e.target.value, 10) || null })} className="font-mono" />
        </div>
        <div className="space-y-1">
          <Label>Max concurrent runs</Label>
          <Input type="number" value={String(form.maxConcurrentRuns ?? 1)} onChange={(e) => setForm({ ...form, maxConcurrentRuns: parseInt(e.target.value, 10) || 1 })} className="font-mono" />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Auto-save cache</Label>
            <p className="text-xs text-muted-foreground">Automatically save cache after runs</p>
          </div>
          <Switch checked={form.autoSaveCache as boolean} onCheckedChange={(v) => setForm({ ...form, autoSaveCache: v })} />
        </div>
        <div className="space-y-1">
          <Label>Retention days</Label>
          <Input type="number" value={String(form.retentionDays ?? 90)} onChange={(e) => setForm({ ...form, retentionDays: parseInt(e.target.value, 10) || 90 })} className="font-mono" />
        </div>
        <div className="space-y-1">
          <Label>Concurrency group (optional)</Label>
          <Input
            type="text"
            value={String(form.concurrencyGroup ?? "")}
            onChange={(e) => setForm({ ...form, concurrencyGroup: e.target.value || null })}
            placeholder="e.g. deploy-group"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Runs in the same group are serialized or cancelled based on the setting below.</p>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Cancel in-progress on new run</Label>
            <p className="text-xs text-muted-foreground">When a new run starts in the same concurrency group, cancel in-progress runs (GitHub Actions style)</p>
          </div>
          <Switch checked={form.cancelInProgress as boolean} onCheckedChange={(v) => setForm({ ...form, cancelInProgress: v })} />
        </div>
        <Button onClick={handleSave} disabled={update.isPending}><Save className="mr-2 size-4" />Save settings</Button>
      </CardContent>
    </Card>
  );
}
