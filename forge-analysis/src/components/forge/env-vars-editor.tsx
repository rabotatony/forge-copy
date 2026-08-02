"use client";

import { useState } from "react";
import { Variable, Plus, Trash2, Loader2, Key } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface EnvVar {
  id: string;
  key: string;
  value: string;
}

/**
 * EnvVarsEditor — manage non-secret environment variables.
 * GitHub Actions has env vars UI — Forge now has one too.
 * (Secrets are managed separately in the Secrets tab.)
 */
export function EnvVarsEditor({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["forge", "projects", projectId, "env-vars"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/env-vars`);
      return (await r.json()) as { envVars: EnvVar[] };
    },
  });

  const createMutation = useMutation({
    mutationFn: async (args: { key: string; value: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/env-vars`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "projects", projectId, "env-vars"] });
      toast.success("Environment variable added");
      setNewKey("");
      setNewValue("");
      setShowAdd(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      await fetch(`/api/forge/projects/${projectId}/env-vars/${key}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "projects", projectId, "env-vars"] });
      toast.info("Environment variable removed");
    },
  });

  const envVars = data?.envVars ?? [];

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    createMutation.mutate({ key: newKey.trim(), value: newValue });
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Variable className="size-4 text-muted-foreground" />
              Environment Variables
            </CardTitle>
            <CardDescription>
              Non-secret env vars injected into every run.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* Add form */}
            {showAdd && (
              <form onSubmit={handleAdd} className="space-y-2 rounded-lg border p-3">
                <div className="space-y-1">
                  <Label htmlFor="env-key" className="text-xs">Key</Label>
                  <Input
                    id="env-key"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="NODE_ENV"
                    className="h-8 font-mono text-sm"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="env-value" className="text-xs">Value</Label>
                  <Input
                    id="env-value"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="production"
                    className="h-8 font-mono text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={createMutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    {createMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Add variable
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {/* List */}
            {envVars.length === 0 && !showAdd ? (
              <div className="flex flex-col items-center gap-1.5 py-4 text-center">
                <Variable className="size-5 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No environment variables.</p>
                <p className="text-xs text-muted-foreground">
                  For secrets, use the Secrets tab. Env vars are visible in logs.
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {envVars.map((v) => (
                  <li key={v.id} className="flex items-center gap-2 rounded-md border p-2">
                    <Key className="size-3.5 shrink-0 text-muted-foreground" />
                    <code className="min-w-0 flex-1 truncate text-xs font-medium">{v.key}</code>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{v.value}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 text-red-600 hover:bg-red-500/10"
                      onClick={() => deleteMutation.mutate(v.key)}
                      disabled={deleteMutation.isPending}
                      aria-label="Delete variable"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {/* Hint */}
            {envVars.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">{envVars.length}</Badge>
                <span>injected into every run as env vars</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
