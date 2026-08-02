"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useSecrets, useSetSecret, useDeleteSecret, useEnvVars, useSetEnvVar, useDeleteEnvVar } from "@/components/forge/use-forge-api-v2";

export function SecretsTab({ projectId }: { projectId: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SecretsPanel projectId={projectId} />
      <EnvVarsPanel projectId={projectId} />
    </div>
  );
}

function SecretsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useSecrets(projectId);
  const setSecret = useSetSecret(projectId);
  const deleteSecret = useDeleteSecret(projectId);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);

  const handleAdd = async () => {
    if (!key || !value) { toast.error("Key and value are required"); return; }
    try {
      await setSecret.mutateAsync({ key, value });
      toast.success(`Secret "${key}" saved`);
      setKey(""); setValue(""); setShowValue(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to save secret"); }
  };

  const handleDelete = async (secretKey: string) => {
    try {
      await deleteSecret.mutateAsync(secretKey);
      toast.success(`Secret "${secretKey}" deleted`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to delete secret"); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2">Secrets <span className="text-sm font-normal text-muted-foreground">({data?.secrets.length ?? 0})</span></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Input placeholder="SECRET_KEY" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-sm" />
          <div className="flex gap-2">
            <Input type={showValue ? "text" : "password"} placeholder="secret value" value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-sm" />
            <Button variant="outline" size="icon" onClick={() => setShowValue(!showValue)} type="button" aria-label={showValue ? "Hide value" : "Show value"}>
              {showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
          <Button onClick={handleAdd} disabled={setSecret.isPending} className="w-full"><Plus className="mr-2 size-4" />Add secret</Button>
        </div>
        <div className="max-h-80 overflow-y-auto space-y-1 [&::-webkit-scrollbar]:w-2">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> :
           data?.secrets.length === 0 ? <p className="text-sm text-muted-foreground">No secrets yet.</p> :
           data?.secrets.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-medium">{s.key}</p>
                <p className="text-xs text-muted-foreground">••••••••</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(s.key)} aria-label={`Delete ${s.key}`}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EnvVarsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useEnvVars(projectId);
  const setEnvVar = useSetEnvVar(projectId);
  const deleteEnvVar = useDeleteEnvVar(projectId);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const handleAdd = async () => {
    if (!key || !value) { toast.error("Key and value are required"); return; }
    try {
      await setEnvVar.mutateAsync({ key, value });
      toast.success(`Env var "${key}" saved`);
      setKey(""); setValue("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to save env var"); }
  };

  const handleDelete = async (envKey: string) => {
    try {
      await deleteEnvVar.mutateAsync(envKey);
      toast.success(`Env var "${envKey}" deleted`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to delete env var"); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2">Environment Variables <span className="text-sm font-normal text-muted-foreground">({data?.envVars.length ?? 0})</span></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Input placeholder="ENV_VAR_NAME" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-sm" />
          <Input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-sm" />
          <Button onClick={handleAdd} disabled={setEnvVar.isPending} className="w-full"><Plus className="mr-2 size-4" />Add env var</Button>
        </div>
        <div className="max-h-80 overflow-y-auto space-y-1 [&::-webkit-scrollbar]:w-2">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> :
           data?.envVars.length === 0 ? <p className="text-sm text-muted-foreground">No env vars yet.</p> :
           data?.envVars.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-md border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-medium">{v.key}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{v.value}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(v.key)} aria-label={`Delete ${v.key}`}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
