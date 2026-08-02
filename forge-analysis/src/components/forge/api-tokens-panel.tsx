"use client";

import { useState } from "react";
import { Key, Plus, Trash2, Loader2, Copy, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  projectId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function ApiTokensPanel() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["forge", "tokens"],
    queryFn: async () => {
      const r = await fetch("/api/forge/tokens");
      return (await r.json()) as { tokens: ApiToken[] };
    },
  });

  const createMutation = useMutation({
    mutationFn: async (args: { name: string; scopes: string }) => {
      const r = await fetch("/api/forge/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      return r.json() as Promise<{ token: string; name: string; id: string }>;
    },
    onSuccess: (data) => {
      setNewToken(data.token);
      qc.invalidateQueries({ queryKey: ["forge", "tokens"] });
      toast.success("Token created — copy it now!");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/forge/tokens/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "tokens"] });
      toast.info("Token revoked");
    },
  });

  const copyToken = () => {
    if (!newToken) return;
    navigator.clipboard?.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="size-4 text-muted-foreground" />
              API Tokens
            </CardTitle>
            <CardDescription>
              External access tokens for the Forge API.
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setNewToken(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="size-4" />
                <span className="hidden sm:inline">Create</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <CreateTokenDialog
                onCreate={(name, scopes) => createMutation.mutate({ name, scopes })}
                pending={createMutation.isPending}
                newToken={newToken}
                copied={copied}
                onCopy={copyToken}
                onClose={() => { setDialogOpen(false); setNewToken(null); }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading tokens…
          </div>
        ) : data?.tokens.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Key className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No API tokens yet.</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Create a token to access Forge from scripts, CI, or external tools.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {data?.tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    <Badge variant="outline" className="text-[10px]">{t.scopes}</Badge>
                  </div>
                  <code className="text-xs text-muted-foreground">{t.prefix}</code>
                  <div className="text-[10px] text-muted-foreground">
                    Created {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastUsedAt && ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`}
                    {t.expiresAt && ` · Expires ${new Date(t.expiresAt).toLocaleDateString()}`}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-red-600 hover:bg-red-500/10"
                  onClick={() => revokeMutation.mutate(t.id)}
                  disabled={revokeMutation.isPending}
                  aria-label="Revoke token"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CreateTokenDialog({
  onCreate,
  pending,
  newToken,
  copied,
  onCopy,
  onClose,
}: {
  onCreate: (name: string, scopes: string) => void;
  pending: boolean;
  newToken: string | null;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read");

  if (newToken) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 text-amber-500" />
            Save your token
          </DialogTitle>
          <DialogDescription>
            This is the only time you&apos;ll see the token. Copy it now.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={newToken} className="font-mono text-xs" />
          <Button size="icon" variant="outline" onClick={onCopy} aria-label="Copy token">
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Create API token</DialogTitle>
        <DialogDescription>
          Tokens allow external tools to access the Forge API.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => { e.preventDefault(); onCreate(name, scopes); }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="token-name">Name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CI bot"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="token-scopes">Scopes</Label>
          <select
            id="token-scopes"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="read">read (view projects + runs)</option>
            <option value="read,run">read + run (trigger workflows)</option>
            <option value="read,run,write">read + run + write (create projects)</option>
            <option value="admin">admin (full access)</option>
          </select>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending || !name.trim()} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Create token
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}
