"use client";

import { useState } from "react";
import { Clock, Plus, Trash2, Loader2, Calendar, Repeat, Play } from "lucide-react";
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

interface Schedule {
  id: string;
  projectId: string;
  workflow: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
}

const CRON_PRESETS: Array<{ label: string; cron: string; desc: string }> = [
  { label: "Every day 9am", cron: "0 9 * * *", desc: "Daily at 9:00 AM" },
  { label: "Weekdays 9am", cron: "0 9 * * 1-5", desc: "Mon-Fri at 9:00 AM" },
  { label: "Every hour", cron: "0 * * * *", desc: "Every hour on the hour" },
  { label: "Every 6 hours", cron: "0 */6 * * *", desc: "4 times a day" },
  { label: "Weekly Monday", cron: "0 9 * * 1", desc: "Every Monday at 9:00 AM" },
  { label: "Monthly 1st", cron: "0 9 1 * *", desc: "1st of every month at 9:00 AM" },
];

export function ScheduledRunsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["forge", "projects", projectId, "scheduled-runs"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/scheduled-runs`);
      return (await r.json()) as { schedules: Schedule[] };
    },
  });

  const createMutation = useMutation({
    mutationFn: async (args: { workflow: string; cron: string }) => {
      const r = await fetch(`/api/forge/projects/${projectId}/scheduled-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forge", "projects", projectId, "scheduled-runs"] });
      toast.success("Schedule created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const schedules = data?.schedules ?? [];

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-muted-foreground" />
              Scheduled Runs
            </CardTitle>
            <CardDescription>
              Automatically run workflows on a cron schedule.
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="size-4" />
                <span className="hidden sm:inline">Schedule</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <CreateScheduleDialog
                onCreate={(workflow, cron) => createMutation.mutate({ workflow, cron })}
                pending={createMutation.isPending}
                onClose={() => setDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading schedules…
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Clock className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No scheduled runs yet.</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Schedule workflows to run automatically — daily tests, weekly security audits, etc.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Repeat className="size-3.5 text-emerald-600" />
                    <code className="text-sm font-medium">{s.workflow}</code>
                    <Badge variant="outline" className="font-mono text-[10px]">{s.cron}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                    {s.nextRunAt && (
                      <span className="flex items-center gap-0.5">
                        <Calendar className="size-2.5" />
                        Next: {new Date(s.nextRunAt).toLocaleString()}
                      </span>
                    )}
                    {s.lastRunAt && (
                      <span>Last: {new Date(s.lastRunAt).toLocaleString()}</span>
                    )}
                    <span>Runs: {s.runCount}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CreateScheduleDialog({
  onCreate,
  pending,
  onClose,
}: {
  onCreate: (workflow: string, cron: string) => void;
  pending: boolean;
  onClose: () => void;
}) {
  const [workflow, setWorkflow] = useState("inspect");
  const [cron, setCron] = useState("0 9 * * 1-5");

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Create scheduled run</DialogTitle>
        <DialogDescription>
          Run a workflow automatically on a cron schedule.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => { e.preventDefault(); onCreate(workflow, cron); onClose(); }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="sched-workflow">Workflow</Label>
          <select
            id="sched-workflow"
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="inspect">inspect</option>
            <option value="build">build</option>
            <option value="test">test</option>
            <option value="lint">lint</option>
            <option value="security-scan">security-scan</option>
            <option value="npm-audit">npm-audit</option>
            <option value="coverage">coverage</option>
            <option value="build-apk">build-apk</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label>Cron presets</Label>
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.cron}
                type="button"
                onClick={() => setCron(p.cron)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:border-emerald-500/40 hover:bg-accent hover:text-foreground"
                title={p.desc}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sched-cron">Cron expression</Label>
          <Input
            id="sched-cron"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 9 * * 1-5"
            className="font-mono text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Format: minute hour day-of-month month day-of-week (UTC)
          </p>
        </div>

        <DialogFooter>
          <Button type="submit" disabled={pending} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Create schedule
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}
