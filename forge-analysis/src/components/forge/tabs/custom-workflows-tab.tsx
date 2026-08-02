"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Play, Code2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useCustomWorkflows, useSaveCustomWorkflow, useValidateCustomWorkflow, useRunCustomWorkflow } from "@/components/forge/use-forge-api-v2";
import { formatRelativeTime } from "@/components/forge/format";
import type { CustomWorkflowStep, CustomWorkflowStepLanguage } from "@/lib/forge/types";

const TEMPLATE = `{
  "name": "My custom workflow",
  "steps": [
    {
      "name": "Lint",
      "run": "npm run lint"
    },
    {
      "name": "Test",
      "run": "npm test",
      "env": { "CI": "true" }
    }
  ]
}`;

// Local view-model used by the visual step editor. `language` is always
// present here (defaults to "bash") so the Select always has a value.
interface StepViewModel {
  name: string;
  language: CustomWorkflowStepLanguage;
}

const LANGUAGE_BADGE: Record<Exclude<CustomWorkflowStepLanguage, "bash">, string> = {
  node: "JS",
  python: "PY",
  ruby: "RB",
};

export function CustomWorkflowsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useCustomWorkflows(projectId);
  const saveWf = useSaveCustomWorkflow(projectId);
  const validateWf = useValidateCustomWorkflow(projectId);
  const runWf = useRunCustomWorkflow(projectId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(TEMPLATE);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);

  // Parse the JSON definition into a lightweight step view-model for the
  // visual language selector. Returns null when the JSON is invalid or the
  // steps array is missing/non-array — in that case we just hide the
  // visual editor and let the user fix the JSON.
  const parsedSteps = useMemo<StepViewModel[] | null>(() => {
    try {
      const obj = JSON.parse(definition) as { steps?: unknown };
      if (!Array.isArray(obj.steps)) return null;
      return obj.steps.map((s) => {
        if (typeof s !== "object" || s === null) return { name: "<invalid>", language: "bash" };
        const step = s as Partial<CustomWorkflowStep> & { language?: unknown };
        const lang = step.language;
        const language: CustomWorkflowStepLanguage =
          lang === "node" || lang === "python" || lang === "ruby" ? lang : "bash";
        return { name: typeof step.name === "string" ? step.name : "<unnamed>", language };
      });
    } catch {
      return null;
    }
  }, [definition]);

  // Update a single step's `language` field in the JSON definition.
  // Setting to "bash" removes the field (since bash is the default) to
  // keep the JSON tidy.
  const setStepLanguage = (idx: number, language: CustomWorkflowStepLanguage) => {
    try {
      const wf = JSON.parse(definition) as { steps?: CustomWorkflowStep[] };
      if (!Array.isArray(wf.steps) || !wf.steps[idx]) return;
      if (language === "bash") {
        const { language: _omit, ...rest } = wf.steps[idx]!;
        void _omit;
        wf.steps[idx] = rest;
      } else {
        wf.steps[idx] = { ...wf.steps[idx]!, language };
      }
      setDefinition(JSON.stringify(wf, null, 2));
      setValidation(null);
    } catch {
      /* ignore — JSON is invalid, user can fix manually */
    }
  };

  const handleValidate = async () => {
    try {
      const wf = JSON.parse(definition);
      const result = await validateWf.mutateAsync(wf);
      setValidation(result);
      if (result.valid) toast.success("Valid workflow definition");
      else toast.error(`Invalid: ${result.errors.join(", ")}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Invalid JSON"); }
  };

  const handleSave = async () => {
    try {
      const wf = JSON.parse(definition);
      await saveWf.mutateAsync({ name, workflow: wf });
      toast.success(`Custom workflow "${name}" saved`);
      setOpen(false);
      setName("");
      setDefinition(TEMPLATE);
      setValidation(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const handleRun = async (workflowId: string, workflowName: string) => {
    try {
      const result = await runWf.mutateAsync({ workflowId });
      toast.success(`"${workflowName}" started: ${result.runId.slice(0, 8)}…`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 size-4" />Create custom workflow</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Create Custom Workflow</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My custom workflow" />
              </div>
              <div className="space-y-1">
                <Label>Definition (JSON)</Label>
                <Textarea value={definition} onChange={(e) => { setDefinition(e.target.value); setValidation(null); }} className="font-mono text-xs min-h-[300px]" />
              </div>
              {parsedSteps && parsedSteps.length > 0 && (
                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-xs text-muted-foreground">Step languages</Label>
                  <div className="space-y-1.5">
                    {parsedSteps.map((step, idx) => (
                      <div key={`${idx}-${step.name}`} className="flex items-center gap-2">
                        <span className="w-32 truncate font-mono text-xs" title={step.name}>{step.name}</span>
                        <Select
                          value={step.language}
                          onValueChange={(v) => setStepLanguage(idx, v as CustomWorkflowStepLanguage)}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bash">Bash</SelectItem>
                            <SelectItem value="node">Node</SelectItem>
                            <SelectItem value="python">Python</SelectItem>
                            <SelectItem value="ruby">Ruby</SelectItem>
                          </SelectContent>
                        </Select>
                        {step.language !== "bash" && (
                          <Badge variant="secondary" className="text-[10px]">
                            {LANGUAGE_BADGE[step.language]}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Node/Python/Ruby steps are written to a temp file in the step’s working dir and run with the matching interpreter.
                  </p>
                </div>
              )}
              {validation && (
                <div className={`flex items-center gap-2 text-sm ${validation.valid ? "text-emerald-600" : "text-red-600"}`}>
                  {validation.valid ? <CheckCircle className="size-4" /> : <XCircle className="size-4" />}
                  {validation.valid ? "Valid" : validation.errors.join("; ")}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleValidate} disabled={validateWf.isPending}>Validate</Button>
                <Button onClick={handleSave} disabled={saveWf.isPending || !name}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="size-5" />
            Custom Workflows
            <span className="text-sm font-normal text-muted-foreground">({data?.customWorkflows.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> :
             data?.customWorkflows.length === 0 ? <p className="text-sm text-muted-foreground">No custom workflows yet.</p> :
             data?.customWorkflows.map((w) => {
               const wf = w.workflow as { steps?: unknown[] } | null;
               const stepCount = wf?.steps?.length ?? 0;
               return (
                 <div key={w.id} className="flex items-center justify-between rounded-md border p-3">
                   <div className="min-w-0 flex-1">
                     <div className="flex items-center gap-2">
                       <span className="font-medium">{w.name}</span>
                       <Badge variant="outline">{stepCount} steps</Badge>
                     </div>
                     <p className="text-xs text-muted-foreground mt-0.5">created {formatRelativeTime(w.createdAt)}</p>
                   </div>
                   <div className="flex gap-1">
                     <Button variant="outline" size="sm" onClick={() => handleRun(w.id, w.name)} disabled={runWf.isPending}>
                       <Play className="mr-1 size-3.5" />Run
                     </Button>
                   </div>
                 </div>
               );
             })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
