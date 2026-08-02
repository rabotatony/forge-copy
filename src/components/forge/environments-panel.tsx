"use client";

import { useState } from "react";
import {
  Plus,
  Server,
  Lock,
  Globe,
  Trash2,
  Loader2,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useEnvironments,
  useCreateEnvironment,
  type Environment,
} from "./use-forge-api";
import { formatRelativeTime } from "./format";

/**
 * EnvironmentsPanel — manage deployment environments (staging/production)
 * with per-environment approval requirements. Like GitHub Environments
 * but simpler: each environment has a name, URL, approval flag, and
 * required reviewer count.
 */
export function EnvironmentsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useEnvironments(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading environments…
        </CardContent>
      </Card>
    );
  }

  const environments = data?.environments ?? [];

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4 text-muted-foreground" aria-hidden />
              Deployment Environments
            </CardTitle>
            <CardDescription>
              Define staging/production environments with approval gates.
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="size-4" />
                <span className="hidden sm:inline">Add</span>
              </Button>
            </DialogTrigger>
            <CreateEnvironmentDialog
              projectId={projectId}
              onCreated={() => setDialogOpen(false)}
            />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {environments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Server className="size-6 opacity-40" aria-hidden />
            <span>No environments yet.</span>
            <span className="max-w-md text-xs">
              Create environments like "staging" or "production" to gate
              deployments behind approvals.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {environments.map((env) => (
              <EnvironmentCard key={env.id} env={env} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EnvironmentCard({ env }: { env: Environment }) {
  const deployments = env.deployments ?? [];
  const lastDep = deployments[0];

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{env.name}</h3>
            {env.requiresApproval && (
              <Badge
                variant="outline"
                className="gap-0.5 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
              >
                <Lock className="size-2.5" />
                Approval
              </Badge>
            )}
            {env.requiredReviewers > 0 && (
              <Badge
                variant="outline"
                className="gap-0.5 px-1.5 text-[10px]"
              >
                <Shield className="size-2.5" />
                {env.requiredReviewers} reviewer{env.requiredReviewers === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          {env.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {env.description}
            </p>
          )}
          {env.url && (
            <a
              href={env.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-400"
            >
              <Globe className="size-3" />
              {env.url}
            </a>
          )}
        </div>
      </div>

      {/* Recent deployments */}
      <div className="mt-3 space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Recent deployments
        </div>
        {deployments.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">None yet</p>
        ) : (
          <ul className="space-y-0.5">
            {deployments.slice(0, 3).map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-1.5 text-[11px]"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    d.status === "success"
                      ? "bg-emerald-500"
                      : d.status === "failed"
                        ? "bg-red-500"
                        : d.status === "in_progress"
                          ? "bg-amber-500 animate-pulse"
                          : "bg-zinc-400",
                  )}
                  aria-hidden
                />
                <span className="font-mono">{d.version ?? d.id.slice(-6)}</span>
                <span className="text-muted-foreground">
                  · {formatRelativeTime(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CreateEnvironmentDialog({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const create = useCreateEnvironment(projectId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [requiredReviewers, setRequiredReviewers] = useState(0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        url: url.trim() || undefined,
        requiresApproval,
        requiredReviewers,
      });
      toast.success(`Created environment "${name}"`);
      setName("");
      setDescription("");
      setUrl("");
      setRequiresApproval(false);
      setRequiredReviewers(0);
      onCreated();
    } catch (err) {
      toast.error(
        `Failed to create: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create deployment environment</DialogTitle>
        <DialogDescription>
          Environments gate deployments behind approvals. Common names:
          staging, production.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="env-name">Name</Label>
          <Input
            id="env-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="production"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="env-desc">Description (optional)</Label>
          <Input
            id="env-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Production deployment target"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="env-url">URL (optional)</Label>
          <Input
            id="env-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://app.example.com"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="env-approval"
            checked={requiresApproval}
            onCheckedChange={(v) => setRequiresApproval(v === true)}
          />
          <Label htmlFor="env-approval" className="text-sm">
            Require approval before deployment
          </Label>
        </div>
        {requiresApproval && (
          <div className="space-y-2">
            <Label htmlFor="env-reviewers">Required reviewers</Label>
            <Input
              id="env-reviewers"
              type="number"
              min={0}
              max={10}
              value={requiredReviewers}
              onChange={(e) => setRequiredReviewers(Number(e.target.value))}
            />
          </div>
        )}
        <DialogFooter>
          <Button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {create.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Create environment"
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
