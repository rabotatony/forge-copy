"use client";

import { useState } from "react";
import { ShieldCheck, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * BadgeShare — generates a status badge URL for embedding in a README.
 * Shows a live preview of the badge + copyable markdown/HTML snippets.
 */
export function BadgeShare({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"url" | "md" | "html" | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const badgeUrl = `${origin}/api/forge/projects/${projectId}/badge`;
  const markdown = `![Forge CI](${badgeUrl})`;
  const html = `<img src="${badgeUrl}" alt="Forge CI" />`;

  const copy = (text: string, which: "url" | "md" | "html") => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck className="size-4" />
          <span className="hidden sm:inline">Badge</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" />
            Status Badge
          </DialogTitle>
          <DialogDescription>
            Embed a live status badge in your README that reflects the
            project&apos;s last run status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Live preview */}
          <div className="rounded-lg border bg-muted/30 p-4 text-center">
            <img
              src={badgeUrl}
              alt="Forge status badge preview"
              className="inline-block"
            />
            <p className="mt-2 text-[10px] text-muted-foreground">
              Live preview — updates automatically
            </p>
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <Label className="text-xs">Badge URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={badgeUrl} className="font-mono text-xs" />
              <Button
                size="icon"
                variant="outline"
                onClick={() => copy(badgeUrl, "url")}
                aria-label="Copy URL"
              >
                {copied === "url" ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Markdown */}
          <div className="space-y-1.5">
            <Label className="text-xs">Markdown</Label>
            <div className="flex gap-2">
              <Input readOnly value={markdown} className="font-mono text-xs" />
              <Button
                size="icon"
                variant="outline"
                onClick={() => copy(markdown, "md")}
                aria-label="Copy markdown"
              >
                {copied === "md" ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* HTML */}
          <div className="space-y-1.5">
            <Label className="text-xs">HTML</Label>
            <div className="flex gap-2">
              <Input readOnly value={html} className="font-mono text-xs" />
              <Button
                size="icon"
                variant="outline"
                onClick={() => copy(html, "html")}
                aria-label="Copy HTML"
              >
                {copied === "html" ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
