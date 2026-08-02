"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Github,
  GitPullRequest,
  GitBranch,
  Play,
  RotateCcw,
  XCircle,
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle as XIcon,
  AlertCircle,
  Clock,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useGitHubStatus,
  useRerunWorkflowRun,
  useCancelWorkflowRun,
  useCreateBranch,
  useCreatePR,
  useDispatchWorkflow,
  type GitHubWorkflowRun,
} from "../use-forge-api";

/**
 * GitHubTab — surfaces GitHub PRs + Actions workflow runs in the project
 * workspace. Lets the user rerun / cancel workflows and open PRs from
 * Forge. When GitHub isn't configured, shows a setup CTA that links to
 * the global settings panel (System → Settings → GitHub).
 */
export function GitHubTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useGitHubStatus(projectId);
  const rerun = useRerunWorkflowRun(projectId);
  const cancel = useCancelWorkflowRun(projectId);
  const [prDialog, setPrDialog] = useState(false);
  const [branchDialog, setBranchDialog] = useState(false);
  const [dispatchDialog, setDispatchDialog] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading GitHub status…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-red-600 dark:text-red-400">
          Failed to load GitHub status: {error instanceof Error ? error.message : "unknown error"}
        </CardContent>
      </Card>
    );
  }

  if (!data?.configured) {
    return (
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Github className="size-4 text-muted-foreground" />
            GitHub Integration
          </CardTitle>
          <CardDescription>
            Connect your repo to see pull requests, trigger Actions workflows, and report Forge run results back to GitHub as check-runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-dashed border-border p-4 text-sm">
            <p className="font-medium">Setup required</p>
            <p className="mt-1 text-muted-foreground">
              Go to <strong>System → Settings → GitHub Integration</strong> and set:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
              <li><code className="font-mono">GITHUB_TOKEN</code> — a Personal Access Token with <code className="font-mono">repo</code> + <code className="font-mono">workflow</code> scopes</li>
              <li><code className="font-mono">GITHUB_OWNER</code> + <code className="font-mono">GITHUB_REPO</code> — the repo to connect (used as fallback if the project's <code className="font-mono">repoUrl</code> isn't a GitHub URL)</li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Or clone the project from a GitHub URL — then <code className="font-mono">owner/repo</code> are parsed automatically and only the token is needed.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FeatureBadge icon={GitPullRequest} title="Pull Requests" desc="Open, list, and merge PRs from Forge" />
            <FeatureBadge icon={Play} title="Actions" desc="Trigger, rerun, cancel GitHub workflows" />
            <FeatureBadge icon={CheckCircle2} title="Check-runs" desc="Forge runs report ✓/✗ inline on commits & PRs" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const ownerRepo = `${data.owner}/${data.repo}`;
  const runningCount = data.runs.filter((r) => r.status === "in_progress" || r.status === "queued").length;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Github className="size-4 shrink-0" />
                <span className="truncate">{ownerRepo}</span>
                {data.canPush && (
                  <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" />
                    write access
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                {data.workflows.length} workflow{data.workflows.length === 1 ? "" : "s"} · {data.prs.length} open PR{data.prs.length === 1 ? "" : "s"} · {runningCount} running
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setBranchDialog(true)} className="gap-1.5">
                <GitBranch className="size-3.5" />
                <span className="hidden sm:inline">Branch</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPrDialog(true)} disabled={!data.canPush} className="gap-1.5">
                <GitPullRequest className="size-3.5" />
                <span className="hidden sm:inline">New PR</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDispatchDialog(true)} disabled={data.workflows.length === 0} className="gap-1.5">
                <Zap className="size-3.5" />
                <span className="hidden sm:inline">Dispatch</span>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Actions runs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Play className="size-4 text-muted-foreground" />
            Recent Workflow Runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.runs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No workflow runs yet.</p>
          ) : (
            <div className="max-h-96 space-y-1.5 overflow-y-auto [&::-webkit-scrollbar]:w-2">
              {data.runs.map((run) => (
                <WorkflowRunRow
                  key={run.id}
                  run={run}
                  onRerun={(failedOnly) =>
                    rerun.mutate(
                      { runId: run.id, failedOnly },
                      {
                        onSuccess: () => toast.success(`Re-run ${failedOnly ? "failed jobs" : "workflow"} queued`),
                        onError: (e) => toast.error(e.message),
                      },
                    )
                  }
                  onCancel={() =>
                    cancel.mutate(run.id, {
                      onSuccess: () => toast.success("Workflow cancellation requested"),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                  busy={rerun.isPending || cancel.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Open PRs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitPullRequest className="size-4 text-muted-foreground" />
            Open Pull Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.prs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No open pull requests.</p>
          ) : (
            <div className="space-y-1.5">
              {data.prs.map((pr) => (
                <a
                  key={pr.number}
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 rounded-md border p-2 transition-colors hover:bg-accent"
                >
                  <GitPullRequest className="size-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{pr.title}</span>
                  <Badge variant="outline" className="shrink-0">#{pr.number}</Badge>
                  <code className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">{pr.head} → {pr.base}</code>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workflows list */}
      {data.workflows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="size-4 text-muted-foreground" />
              Workflow Definitions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {data.workflows.map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-md border p-2 gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{w.name}</p>
                    <code className="truncate text-xs text-muted-foreground">{w.path}</code>
                  </div>
                  <Badge variant={w.state === "active" ? "secondary" : "outline"} className="shrink-0">{w.state}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <NewPRDialog open={prDialog} onOpenChange={setPrDialog} projectId={projectId} defaultBranch={data.defaultBranch} />
      <NewBranchDialog open={branchDialog} onOpenChange={setBranchDialog} projectId={projectId} />
      <DispatchDialog open={dispatchDialog} onOpenChange={setDispatchDialog} projectId={projectId} workflows={data.workflows} defaultBranch={data.defaultBranch ?? "main"} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeatureBadge({ icon: Icon, title, desc }: { icon: typeof Github; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card/30 p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function WorkflowRunRow({
  run,
  onRerun,
  onCancel,
  busy,
}: {
  run: GitHubWorkflowRun;
  onRerun: (failedOnly: boolean) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const isRunning = run.status === "in_progress" || run.status === "queued";
  const conclusionIcon =
    run.conclusion === "success" ? <CheckCircle2 className="size-4 text-emerald-600" />
    : run.conclusion === "failure" ? <XIcon className="size-4 text-rose-600" />
    : run.conclusion === "cancelled" ? <XCircle className="size-4 text-muted-foreground" />
    : isRunning ? <Loader2 className="size-4 animate-spin text-amber-600" />
    : <AlertCircle className="size-4 text-muted-foreground" />;

  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      {conclusionIcon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{run.displayTitle || run.name || `Run #${run.id}`}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">{run.event}</Badge>
          <code className="truncate font-mono">{run.branch}</code>
          {run.startedAt && (
            <span className="flex items-center gap-0.5">
              <Clock className="size-3" />
              {new Date(run.startedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a href={run.htmlUrl} target="_blank" rel="noreferrer noopener" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="View on GitHub">
          <ExternalLink className="size-3.5" />
        </a>
        {!isRunning && (
          <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy} onClick={() => onRerun(false)}>
            <RotateCcw className="size-3" />
            <span className="hidden sm:inline">Rerun</span>
          </Button>
        )}
        {!isRunning && run.conclusion === "failure" && (
          <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy} onClick={() => onRerun(true)}>
            <RotateCcw className="size-3" />
            <span className="hidden sm:inline">Failed only</span>
          </Button>
        )}
        {isRunning && (
          <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-red-600 hover:bg-red-500/10" disabled={busy} onClick={onCancel}>
            <XCircle className="size-3" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function NewPRDialog({ open, onOpenChange, projectId, defaultBranch }: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string; defaultBranch?: string | null }) {
  const createPR = useCreatePR(projectId);
  const [title, setTitle] = useState("");
  const [head, setHead] = useState("");
  const [base, setBase] = useState("");
  const [body, setBody] = useState("");
  const qc = useQueryClient();
  const effectiveBase = base.trim() || defaultBranch || "main";

  const submit = () => {
    if (!title.trim() || !head.trim()) {
      toast.error("Title and head branch are required");
      return;
    }
    createPR.mutate(
      { title: title.trim(), head: head.trim(), body, base: effectiveBase },
      {
        onSuccess: (data) => {
          toast.success("Pull request opened");
          qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] });
          onOpenChange(false);
          setTitle(""); setHead(""); setBase(""); setBody("");
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitPullRequest className="size-4" /> New Pull Request</DialogTitle>
          <DialogDescription>Open a PR from a head branch into a base branch.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pr-title">Title</Label>
            <Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="feat: add new endpoint" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-head">Head branch (source)</Label>
              <Input id="pr-head" value={head} onChange={(e) => setHead(e.target.value)} placeholder="my-feature-branch" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-base">Base branch (target)</Label>
              <Input id="pr-base" value={base} onChange={(e) => setBase(e.target.value)} placeholder={defaultBranch ?? "main"} className="font-mono text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-body">Description</Label>
            <Textarea id="pr-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the changes…" className="min-h-[100px] text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createPR.isPending} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
            {createPR.isPending && <Loader2 className="size-4 animate-spin" />}
            Open PR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewBranchDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string }) {
  const createBranch = useCreateBranch(projectId);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const qc = useQueryClient();

  const submit = () => {
    if (!name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    createBranch.mutate(
      { name: name.trim(), base: base.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Branch '${name.trim()}' created`);
          qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] });
          onOpenChange(false);
          setName(""); setBase("");
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitBranch className="size-4" /> Create Branch</DialogTitle>
          <DialogDescription>Creates a new branch off the repo's default branch (or a specified base) via the GitHub API.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="branch-name">Branch name</Label>
            <Input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/new-api" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch-base">Base branch <span className="text-xs text-muted-foreground">(optional — defaults to repo default)</span></Label>
            <Input id="branch-base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="main" className="font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createBranch.isPending} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
            {createBranch.isPending && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DispatchDialog({ open, onOpenChange, projectId, workflows, defaultBranch }: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string; workflows: Array<{ id: number; name: string; state?: string }>; defaultBranch: string }) {
  const dispatch = useDispatchWorkflow(projectId);
  const [workflowId, setWorkflowId] = useState<number | null>(null);
  const [ref, setRef] = useState(defaultBranch);
  const qc = useQueryClient();
  // Only show active workflows — disabled ones can't be dispatched (GitHub 422).
  const activeWorkflows = workflows.filter((w) => w.state !== "disabled_manually" && w.state !== "disabled_inactivity");

  const submit = () => {
    if (workflowId === null) {
      toast.error("Select a workflow");
      return;
    }
    if (!ref.trim()) {
      toast.error("Ref (branch/tag) is required");
      return;
    }
    dispatch.mutate(
      { workflowId, ref: ref.trim() },
      {
        onSuccess: () => {
          toast.success("Workflow dispatch sent");
          qc.invalidateQueries({ queryKey: ["forge", "github", "status", projectId] });
          onOpenChange(false);
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="size-4" /> Trigger Workflow</DialogTitle>
          <DialogDescription>Dispatch a <code className="font-mono text-xs">workflow_dispatch</code> event. The workflow must have a <code className="font-mono text-xs">workflow_dispatch</code> trigger in its YAML.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wf-select">Workflow</Label>
            <select
              id="wf-select"
              value={workflowId ?? ""}
              onChange={(e) => setWorkflowId(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="" disabled>Select a workflow…</option>
              {activeWorkflows.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
              {activeWorkflows.length === 0 && <option value="" disabled>No active workflows (all disabled)</option>}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-ref">Ref (branch or tag)</Label>
            <Input id="wf-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" className="font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={dispatch.isPending} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
            {dispatch.isPending && <Loader2 className="size-4 animate-spin" />}
            Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
