"use client";

// ============================================================
// Forge — Repository panel (project page)
// ============================================================
// First-class repo management for a project: link a remote, pull
// updates, switch branches, browse commit history, and see the
// working-tree status. This is the "hold & maintain a repo" view.
//
// Backed by /api/forge/projects/[id]/repo/* (see src/lib/forge/git.ts).
// ============================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  GitFork,
  RefreshCw,
  Link2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Globe,
  Clock,
  FileEdit,
  FilePlus,
  FileMinus,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  GitCommitHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types — mirror API shapes
// ---------------------------------------------------------------------------

interface RepoInfo {
  isRepo: boolean;
  url: string | null;
  branch: string | null;
  provider: string | null;
  depth: number;
  lastPulledAt: string | null;
  lastFetchAt: string | null;
}

interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
}

interface BranchesResponse {
  current: string;
  branches: Branch[];
}

interface CommitEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

interface FileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
}

interface StatusResponse {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
  clean: boolean;
  ahead: number;
  behind: number;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RepositoryPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBranch, setLinkBranch] = useState("");

  const repoInfo = useQuery<RepoInfo>({
    queryKey: ["repo-info", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo`);
      if (!r.ok) throw new Error("Failed to load repo info");
      return r.json();
    },
  });

  const branches = useQuery<BranchesResponse>({
    queryKey: ["repo-branches", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo/branches`);
      if (!r.ok) throw new Error("Failed to load branches");
      return r.json();
    },
    enabled: !!repoInfo.data?.isRepo,
  });

  const log = useQuery<CommitEntry[]>({
    queryKey: ["repo-log", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo/log?max=25`);
      if (!r.ok) throw new Error("Failed to load log");
      const data = await r.json();
      return Array.isArray(data) ? data : (data.commits ?? []);
    },
    enabled: !!repoInfo.data?.isRepo,
  });

  const status = useQuery<StatusResponse>({
    queryKey: ["repo-status", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo/status`);
      if (!r.ok) throw new Error("Failed to load status");
      return r.json();
    },
    enabled: !!repoInfo.data?.isRepo,
    refetchInterval: 15_000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["repo-info", projectId] });
    queryClient.invalidateQueries({ queryKey: ["repo-branches", projectId] });
    queryClient.invalidateQueries({ queryKey: ["repo-log", projectId] });
    queryClient.invalidateQueries({ queryKey: ["repo-status", projectId] });
  };

  const pullMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo/pull`, { method: "POST" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Pull failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      invalidateAll();
      toast.success("Pulled", {
        description: data.stdout?.trim()?.slice(0, 120) || "Repository updated.",
      });
    },
    onError: (e: Error) => toast.error("Pull failed", { description: e.message }),
  });

  const fetchMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo/fetch`, { method: "POST" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Fetch failed");
      }
      return r.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Fetched", { description: "Remote refs updated." });
    },
    onError: (e: Error) => toast.error("Fetch failed", { description: e.message }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async (branch: string) => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Checkout failed");
      }
      return r.json();
    },
    onSuccess: (_data, branch) => {
      invalidateAll();
      toast.success("Switched branch", { description: branch });
    },
    onError: (e: Error) => toast.error("Checkout failed", { description: e.message }),
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/repo/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl, branch: linkBranch || undefined, depth: 1 }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Link failed");
      }
      return r.json();
    },
    onSuccess: () => {
      setLinkUrl("");
      setLinkBranch("");
      invalidateAll();
      toast.success("Repository linked", { description: "You can now pull, switch branches, and browse history." });
    },
    onError: (e: Error) => toast.error("Link failed", { description: e.message }),
  });

  if (repoInfo.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Loading repository…
        </CardContent>
      </Card>
    );
  }

  const info = repoInfo.data;

  // Not a repo yet — show the link form.
  if (!info?.isRepo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4 text-emerald-600" aria-hidden />
            Link a Repository
          </CardTitle>
          <CardDescription>
            Connect this project to a git remote so you can pull updates,
            switch branches, and browse history. The repo becomes the source
            of truth — workflows run against the working tree.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input
              id="repo-url"
              placeholder="https://github.com/owner/repo.git"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              HTTPS or SSH. The repo is cloned into the project directory.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-branch">Branch (optional)</Label>
            <Input
              id="repo-branch"
              placeholder="main"
              value={linkBranch}
              onChange={(e) => setLinkBranch(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!linkUrl.trim() || linkMutation.isPending}
            className="gap-1.5"
          >
            {linkMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            Link & Clone
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Repo is linked — show the full management view.
  const st = status.data;
  const aheadBehind = st ? (
    <div className="flex items-center gap-2 text-xs">
      {st.ahead > 0 && (
        <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">
          <ArrowUp className="size-3" /> {st.ahead} ahead
        </Badge>
      )}
      {st.behind > 0 && (
        <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400">
          <ArrowDown className="size-3" /> {st.behind} behind
        </Badge>
      )}
      {st.ahead === 0 && st.behind === 0 && (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <CheckCircle2 className="size-3" /> in sync
        </Badge>
      )}
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {/* Repo header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <GitFork className="size-4 text-emerald-600" aria-hidden />
                <span className="truncate">{info.url ? prettyUrl(info.url) : "Repository"}</span>
                <ProviderBadge provider={info.provider} />
              </CardTitle>
              <CardDescription className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="flex items-center gap-1">
                  <GitBranch className="size-3" />
                  {branches.data?.current ?? info.branch ?? "—"}
                </span>
                {info.lastPulledAt && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="size-3" /> pulled {formatRelativeTime(new Date(info.lastPulledAt))}
                  </span>
                )}
                {info.depth > 0 && (
                  <Badge variant="outline" className="text-[10px]">depth {info.depth}</Badge>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchMutation.mutate()}
                disabled={fetchMutation.isPending}
                className="gap-1.5"
              >
                {fetchMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Fetch
              </Button>
              <Button
                size="sm"
                onClick={() => pullMutation.mutate()}
                disabled={pullMutation.isPending}
                className="gap-1.5"
              >
                {pullMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <GitPullRequest className="size-3.5" />
                )}
                Pull
              </Button>
              {info.url && (
                <Button size="sm" variant="ghost" asChild className="gap-1.5">
                  <a href={info.url} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="size-3.5" />
                    <span className="hidden sm:inline">Open</span>
                  </a>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        {st && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              {st.clean ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" /> Working tree clean
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-3.5" /> Working tree has changes
                </span>
              )}
              {aheadBehind}
              <span className="ml-auto text-[10px] text-muted-foreground">
                {st.unstaged.length + st.staged.length + st.untracked.length} changed
              </span>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Branches */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="size-4 text-emerald-600" aria-hidden />
              Branches
            </CardTitle>
            <CardDescription className="text-xs">
              Switch the working tree to another branch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {branches.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading branches…
              </div>
            ) : (
              <BranchList
                branches={branches.data?.branches ?? []}
                current={branches.data?.current ?? ""}
                onCheckout={(b) => checkoutMutation.mutate(b)}
                checkingOut={checkoutMutation.isPending}
              />
            )}
          </CardContent>
        </Card>

        {/* Status detail */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileEdit className="size-4 text-emerald-600" aria-hidden />
              Working Tree
            </CardTitle>
            <CardDescription className="text-xs">
              Staged, unstaged, and untracked changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading status…
              </div>
            ) : st?.clean ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No changes — working tree is clean.
              </div>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-1 pr-2 font-mono text-[11px]">
                  {st?.staged.map((f, i) => (
                    <FileChangeRow key={`s${i}`} path={f.path} status={f.status} area="staged" />
                  ))}
                  {st?.unstaged.map((f, i) => (
                    <FileChangeRow key={`u${i}`} path={f.path} status={f.status} area="unstaged" />
                  ))}
                  {st?.untracked.map((p, i) => (
                    <FileChangeRow key={`t${i}`} path={p} status="added" area="untracked" />
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Commit history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitCommit className="size-4 text-emerald-600" aria-hidden />
            Recent Commits
          </CardTitle>
          <CardDescription className="text-xs">
            Latest 25 commits on the current branch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {log.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading history…
            </div>
          ) : (log.data?.length ?? 0) === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No commits found.
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="divide-y divide-border">
                {log.data?.map((c) => (
                  <div key={c.hash} className="flex items-start gap-3 py-2">
                    <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.subject}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">{c.hash.slice(0, 7)}</span>
                        <span>{c.author}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(new Date(c.date))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BranchList({
  branches,
  current,
  onCheckout,
  checkingOut,
}: {
  branches: Branch[];
  current: string;
  onCheckout: (b: string) => void;
  checkingOut: boolean;
}) {
  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote);
  if (local.length === 0 && remote.length === 0) {
    return <div className="py-4 text-center text-xs text-muted-foreground">No branches found.</div>;
  }
  return (
    <div className="space-y-3">
      {local.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Local
          </div>
          <Select value={current} onValueChange={onCheckout} disabled={checkingOut}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {local.map((b) => (
                <SelectItem key={b.name} value={b.name} className="font-mono text-xs">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {remote.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Remote ({remote.length})
          </div>
          <ScrollArea className="max-h-32">
            <div className="space-y-0.5 pr-2 font-mono text-[11px]">
              {remote.slice(0, 20).map((b) => (
                <div key={b.name} className="flex items-center gap-1.5 truncate text-muted-foreground">
                  <Globe className="size-3 shrink-0" />
                  <span className="truncate">{b.name}</span>
                </div>
              ))}
              {remote.length > 20 && (
                <div className="text-[10px] text-muted-foreground">+{remote.length - 20} more</div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function FileChangeRow({ path, status, area }: { path: string; status: FileChange["status"]; area: "staged" | "unstaged" | "untracked" }) {
  const Icon = status === "added" ? FilePlus : status === "deleted" ? FileMinus : FileEdit;
  const color =
    status === "added" ? "text-emerald-600 dark:text-emerald-400"
    : status === "deleted" ? "text-rose-600 dark:text-rose-400"
    : "text-amber-600 dark:text-amber-400";
  return (
    <div className="flex items-center gap-2 truncate py-0.5">
      <Icon className={cn("size-3 shrink-0", color)} />
      <span className="truncate">{path}</span>
      <span className="ml-auto shrink-0 text-[9px] uppercase text-muted-foreground">{area}</span>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string | null }) {
  if (!provider || provider === "other") return null;
  const label = provider.charAt(0).toUpperCase() + provider.slice(1);
  return <Badge variant="outline" className="text-[10px]">{label}</Badge>;
}

function prettyUrl(url: string): string {
  // Strip .git suffix and protocol for display.
  return url.replace(/^https?:\/\//, "").replace(/\.git$/, "");
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString();
}
