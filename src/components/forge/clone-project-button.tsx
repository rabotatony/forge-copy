"use client";

import { useState } from "react";
import { Copy, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";

interface CloneResponse {
  project: {
    id: string;
    name: string;
    kind: string;
    fileCount: number;
    createdAt: string;
  };
}

/**
 * CloneProjectButton — duplicates a project via POST to
 * `/api/forge/projects/[id]/clone`. Shows a brief success checkmark,
 * fires `onCloned(newId)` so the parent can navigate / refresh, and
 * surfaces errors via sonner.
 *
 * Uses emerald accents (NEVER indigo or blue) per project convention.
 */
export function CloneProjectButton({
  projectId,
  onCloned,
}: {
  projectId: string;
  onCloned?: (newId: string) => void;
}) {
  const [justSucceeded, setJustSucceeded] = useState(false);

  const cloneMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/clone`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Clone failed (${r.status})`);
      }
      return (await r.json()) as CloneResponse;
    },
    onSuccess: (data) => {
      toast.success("Project cloned");
      setJustSucceeded(true);
      window.setTimeout(() => setJustSucceeded(false), 1500);
      onCloned?.(data.project.id);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const isPending = cloneMutation.isPending;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => cloneMutation.mutate()}
      disabled={isPending}
      className="text-emerald-600 hover:text-emerald-700 hover:border-emerald-400/60 dark:text-emerald-400 dark:hover:text-emerald-300"
      aria-label="Clone project"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : justSucceeded ? (
        <Check className="size-4 text-emerald-500" />
      ) : (
        <Copy className="size-4" />
      )}
      <span className="hidden sm:inline">Clone project</span>
      <span className="sm:hidden">Clone</span>
    </Button>
  );
}
