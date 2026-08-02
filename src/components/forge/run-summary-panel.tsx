"use client";

import { useState } from "react";
import { FileText, Save, Loader2, Edit3 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRunSummary, useSaveSummary } from "./use-forge-api";

/**
 * RunSummaryPanel — markdown summary for a run, like $GITHUB_STEP_SUMMARY.
 * Workflows can write a summary (via API) that renders in the run view.
 * Users can also edit it manually.
 */
export function RunSummaryPanel({ runId }: { runId: string }) {
  const { data, isLoading } = useRunSummary(runId);
  const save = useSaveSummary(runId);
  const [editing, setEditing] = useState(false);

  // Use a key on the inner editor so it resets when the loaded summary changes.
  const loadedSummary = data?.summary ?? "";

  const onSave = async (content: string) => {
    try {
      await save.mutateAsync(content);
      toast.success("Summary saved");
      setEditing(false);
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading summary…
        </CardContent>
      </Card>
    );
  }

  const summary = data?.summary;

  if (!summary && !editing) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
          <FileText className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No summary for this run.</p>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Edit3 className="size-3.5" />
            Add summary
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-muted-foreground" />
              Summary
            </CardTitle>
            <CardDescription className="text-xs">
              Markdown summary (like $GITHUB_STEP_SUMMARY)
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Edit3 className="size-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <SummaryEditor
            key={loadedSummary}
            initialContent={loadedSummary}
            onSave={onSave}
            onCancel={() => setEditing(false)}
            saving={save.isPending}
          />
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownLite content={summary ?? ""} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryEditor({
  initialContent,
  onSave,
  onCancel,
  saving,
}: {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(initialContent);
  return (
    <div className="space-y-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={"## Build Results\n\nAll tests passed! ✅\n- 42 tests\n- 0 failures\n- Duration: 1.2s"}
        className="min-h-[200px] font-mono text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(draft)}
          disabled={saving}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Minimal markdown renderer (headings, bold, code, lists, links).
 * Avoids pulling in a full markdown library for this small surface.
 */
function MarkdownLite({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="ml-4 list-disc space-y-0.5">
          {listItems.map((item, i) => (
            <li key={i} className="text-sm">{renderInline(item)}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("### ")) {
      flushList();
      elements.push(<h4 key={i} className="text-sm font-semibold mt-2">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(<h3 key={i} className="text-base font-semibold mt-3">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      flushList();
      elements.push(<h2 key={i} className="text-lg font-bold mt-3">{renderInline(line.slice(2))}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    }
  }
  flushList();

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode[] {
  // Render **bold** and `code` and [link](url).
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={idx++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={idx++} className="rounded bg-muted px-1 py-0.5 text-xs">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m) parts.push(<a key={idx++} href={m[2]} className="text-emerald-600 hover:underline" target="_blank" rel="noreferrer">{m[1]}</a>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
