"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Github, Key, Loader2, CheckCircle2, XCircle, Eye, EyeOff, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function GitHubSettings() {
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [showToken, setShowToken] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["forge", "settings"],
    queryFn: async () => { const r = await fetch("/api/forge/settings"); if (!r.ok) throw new Error("Failed"); return r.json(); },
  });

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, string>) => {
      const r = await fetch("/api/forge/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("Failed"); return r.json();
    },
    onSuccess: () => { toast.success("GitHub settings saved"); setToken(""); qc.invalidateQueries({ queryKey: ["forge", "settings"] }); },
    onError: (err: Error) => toast.error("Failed", { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => { await fetch(`/api/forge/settings?key=${key}`, { method: "DELETE" }); },
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["forge", "settings"] }); },
  });

  const handleSave = () => {
    const body: Record<string, string> = {};
    if (token) body.GITHUB_TOKEN = token;
    if (owner) body.GITHUB_OWNER = owner;
    if (repo) body.GITHUB_REPO = repo;
    if (Object.keys(body).length === 0) { toast.error("Fill in at least one field"); return; }
    saveMutation.mutate(body);
  };

  if (isLoading) return <Card><CardContent className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>;

  const s = data?.settings ?? {};
  const ready = s._githubReady?.set ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Github className="h-5 w-5" /> GitHub Integration</CardTitle>
            <CardDescription className="mt-1">Connect Forge to your GitHub repo for PR creation, CI fixes, and code review.</CardDescription>
          </div>
          {ready ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"><CheckCircle2 className="mr-1 h-3 w-3" />Connected</Badge> : <Badge variant="secondary"><XCircle className="mr-1 h-3 w-3" />Not configured</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-1.5"><Key className="h-3.5 w-3.5" /> GitHub Token</label>
          <div className="flex gap-2">
            <Input type={showToken ? "text" : "password"} placeholder={s.GITHUB_TOKEN?.set ? s.GITHUB_TOKEN.preview : "ghp_EXAMPLE"} value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />
            <Button type="button" variant="outline" size="icon" onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Create at: GitHub → Settings → Developer settings → Personal access tokens. Scopes: <code>repo</code>, <code>workflow</code>.</p>
        </div>
        <div className="space-y-2"><label className="text-sm font-medium">GitHub Username / Org</label><Input placeholder={s.GITHUB_OWNER?.set ? s.GITHUB_OWNER.preview : "username"} value={owner} onChange={(e) => setOwner(e.target.value)} /></div>
        <div className="space-y-2"><label className="text-sm font-medium">Repository Name</label><Input placeholder={s.GITHUB_REPO?.set ? s.GITHUB_REPO.preview : "repo"} value={repo} onChange={(e) => setRepo(e.target.value)} /></div>
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saveMutation.isPending}>{saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button>
          {(s.GITHUB_TOKEN?.set || s.GITHUB_OWNER?.set) && <Button variant="outline" onClick={() => { if (confirm("Remove all?")) { deleteMutation.mutate("GITHUB_TOKEN"); deleteMutation.mutate("GITHUB_OWNER"); deleteMutation.mutate("GITHUB_REPO"); } }}><Trash2 className="mr-2 h-4 w-4" />Remove</Button>}
        </div>
        <div className="rounded-lg bg-muted/50 p-4 text-xs space-y-1.5">
          <div className="font-medium text-sm mb-2">Enables:</div>
          <div className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /><span><strong>Test Writer</strong> — generates tests, runs them, opens PR</span></div>
          <div className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /><span><strong>CI Healer</strong> — reads CI failures, fixes, opens PR</span></div>
          <div className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /><span><strong>Perf Optimizer</strong> — benchmarks, optimizes, opens PR</span></div>
        </div>
        <div className="text-xs text-muted-foreground border-t pt-3"><strong>🔒 Security:</strong> Token encrypted with AES-256-GCM. Never logged, never returned by API.</div>
      </CardContent>
    </Card>
  );
}
