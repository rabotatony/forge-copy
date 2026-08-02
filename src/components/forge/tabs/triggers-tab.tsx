"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Clock, Webhook, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTriggers, useCreateTrigger, useDeleteTrigger } from "@/components/forge/use-forge-api";
import { formatRelativeTime } from "@/components/forge/format";

export function TriggersTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useTriggers(projectId);
  const createTrigger = useCreateTrigger(projectId);
  const deleteTrigger = useDeleteTrigger(projectId);
  const [type, setType] = useState<"webhook" | "cron">("webhook");
  const [workflow, setWorkflow] = useState("inspect");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [secret, setSecret] = useState("");

  const handleCreate = async () => {
    try {
      const config: Record<string, string> = type === "cron" ? { expression: cronExpr } : {};
      await createTrigger.mutateAsync({ type, workflow, config, secret: secret || undefined });
      toast.success(`${type === "webhook" ? "Webhook" : "Cron"} trigger created`);
      setSecret("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const handleDelete = async (triggerId: string) => {
    try {
      await deleteTrigger.mutateAsync(triggerId);
      toast.success("Trigger deleted");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const copyUrl = (slug: string) => {
    const url = `${window.location.origin}/api/forge/triggers/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Webhook URL copied");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-5" />Create Trigger</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "webhook" | "cron")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="cron">Cron schedule</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Workflow</Label>
              <Input value={workflow} onChange={(e) => setWorkflow(e.target.value)} className="font-mono text-sm" />
            </div>
            {type === "cron" && (
              <div className="space-y-2">
                <Label>Cron expression (min hour day month weekday)</Label>
                <Input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} className="font-mono text-sm" placeholder="0 9 * * 1" />
              </div>
            )}
            {type === "webhook" && (
              <div className="space-y-2">
                <Label>HMAC secret (optional)</Label>
                <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className="font-mono text-sm" placeholder="shared secret" />
              </div>
            )}
          </div>
          <Button onClick={handleCreate} disabled={createTrigger.isPending}>
            <Plus className="mr-2 size-4" />Create trigger
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Triggers
            <span className="text-sm font-normal text-muted-foreground">({data?.triggers.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto space-y-2 [&::-webkit-scrollbar]:w-2">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> :
             data?.triggers.length === 0 ? <p className="text-sm text-muted-foreground">No triggers yet.</p> :
             data?.triggers.map((t) => {
               const cfg = { slug: t.type === 'webhook' ? t.config : undefined, expression: t.type === 'cron' ? t.config : undefined };
               
               return (
                 <div key={t.id} className="flex items-start justify-between rounded-md border p-3 gap-2">
                   <div className="min-w-0 flex-1 space-y-1">
                     <div className="flex items-center gap-2 flex-wrap">
                       {t.type === "webhook" ? <Webhook className="size-4 text-emerald-600" /> : <Clock className="size-4 text-amber-600" />}
                       <Badge variant="outline">{t.type}</Badge>
                       <span className="font-mono text-sm font-medium">{t.workflow}</span>
                       <Switch checked={t.enabled} disabled aria-label="enabled" />
                     </div>
                     {t.type === "webhook" && cfg.slug && (
                       <div className="flex items-center gap-1">
                         <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-xs">/api/forge/triggers/{cfg.slug}</code>
                         <Button variant="ghost" size="icon" className="size-6" onClick={() => copyUrl(cfg.slug!)} aria-label="Copy URL">
                           <Copy className="size-3" />
                         </Button>
                       </div>
                     )}
                     {t.type === "cron" && cfg.expression && (
                       <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{cfg.expression}</code>
                     )}
                     {t.lastFiredAt && (
                       <p className="text-xs text-muted-foreground">Last fired {formatRelativeTime(t.lastFiredAt)}</p>
                     )}
                   </div>
                   <Button variant="ghost" size="icon" onClick={() => handleDelete(t.id)} aria-label="Delete trigger">
                     <Trash2 className="size-4 text-destructive" />
                   </Button>
                 </div>
               );
             })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
