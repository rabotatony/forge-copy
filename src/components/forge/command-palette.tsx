"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Home,
  Upload,
  Search,
  Moon,
  Sun,
  Monitor,
  Github,
  Activity,
  Zap,
  FileArchive,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useProjects } from "./use-forge-api";
import { WORKFLOW_CATEGORIES } from "@/lib/forge/categories";
import { toast } from "sonner";

interface CommandAction {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  shortcut?: string;
  group: string;
  action: () => void;
}

/**
 * CommandPalette — a Cmd+K / Ctrl+K dialog for fast navigation and actions.
 *
 * Features:
 *   - Search projects (click to open)
 *   - Quick actions: go home, upload, toggle theme
 *   - Browse all workflow categories
 *   - Keyboard-first: arrow keys + enter
 *
 * Opens with Cmd+K (Mac) or Ctrl+K (Windows/Linux).
 */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenProject,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProject?: (id: string) => void;
  onUpload?: () => void;
}) {
  const { setTheme } = useTheme();
  const { data: projectsData } = useProjects();
  const router = useRouter();

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const [query, setQuery] = useState("");

  const run = useCallback(
    (fn: () => void) => {
      fn();
      close();
    },
    [close],
  );

  const projects = projectsData?.projects ?? [];

  const actions: CommandAction[] = [
    {
      id: "go-home",
      label: "Go to home",
      description: "Project list",
      icon: Home,
      shortcut: "G H",
      group: "Navigation",
      action: () => router.push("/"),
    },
    {
      id: "upload",
      label: "Upload a project file",
      description: "Drop a ZIP, HTML, or any file",
      icon: Upload,
      shortcut: "U",
      group: "Navigation",
      action: () => onUpload?.(),
    },
    {
      id: "theme-light",
      label: "Switch to light theme",
      icon: Sun,
      group: "Theme",
      action: () => {
        setTheme("light");
        toast.success("Switched to light theme");
      },
    },
    {
      id: "theme-dark",
      label: "Switch to dark theme",
      icon: Moon,
      group: "Theme",
      action: () => {
        setTheme("dark");
        toast.success("Switched to dark theme");
      },
    },
    {
      id: "theme-system",
      label: "Use system theme",
      icon: Monitor,
      group: "Theme",
      action: () => {
        setTheme("system");
        toast.success("Following system theme");
      },
    },
    {
      id: "docs",
      label: "Open Next.js docs",
      icon: Github,
      group: "Links",
      action: () => window.open("https://nextjs.org", "_blank"),
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search projects, workflows, runs, logs…" onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Global search results (appears when typing 2+ chars) */}
        {query && query.length >= 2 && (
          <GlobalSearch onOpenProject={onOpenProject} />
        )}

        {/* Quick actions */}
        <CommandGroup heading="Quick Actions">
          {actions.map((a) => (
            <CommandItem
              key={a.id}
              value={`${a.label} ${a.description ?? ""}`}
              onSelect={() => run(a.action)}
            >
              <a.icon className="size-4 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{a.label}</span>
                {a.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    · {a.description}
                  </span>
                )}
              </div>
              {a.shortcut && (
                <CommandShortcut>{a.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Projects */}
        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.slice(0, 8).map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.fileName} ${p.kind}`}
                onSelect={() =>
                  run(() => {
                    onOpenProject?.(p.id);
                  })
                }
              >
                <FileArchive className="size-4 text-emerald-600" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    · {p.fileName}
                  </span>
                </div>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase">
                  {p.kind}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* Workflow categories */}
        <CommandGroup heading="Workflow Categories">
          {WORKFLOW_CATEGORIES.map((cat) => (
            <CommandItem
              key={cat.id}
              value={`workflow ${cat.label} ${cat.description} ${cat.workflows.join(" ")}`}
              onSelect={() =>
                run(() => {
                  toast.info(`${cat.emoji} ${cat.label}: ${cat.workflows.length} workflows available per project`);
                })
              }
            >
              <span className="text-base">{cat.emoji}</span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{cat.label}</span>
                <span className="truncate text-xs text-muted-foreground">
                  · {cat.description}
                </span>
              </div>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                {cat.workflows.length}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------
// GlobalSearch — searches across projects, runs, and logs
// ---------------------------------------------------------------------------

function GlobalSearch({ onOpenProject }: { onOpenProject?: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{
    type: string; id: string; title: string; subtitle: string; href: string;
  }>>([]);

  useEffect(() => {
    if (query.length < 2) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/forge/search?q=${encodeURIComponent(query)}`);
        if (r.ok) {
          const data = await r.json();
          setResults(data.results ?? []);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (results.length === 0) return null;

  const icons: Record<string, LucideIcon> = {
    project: FileArchive,
    run: Activity,
    log: Search,
  };

  return (
    <CommandGroup heading="Global Search Results">
      {results.slice(0, 8).map((r) => {
        const Icon = icons[r.type] ?? Search;
        return (
          <CommandItem
            key={`${r.type}-${r.id}`}
            value={`search ${r.title} ${r.subtitle}`}
            onSelect={() => {
              if (r.type === "project" && onOpenProject) {
                onOpenProject(r.id);
              }
            }}
          >
            <Icon className="size-4 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{r.title}</span>
              <span className="truncate text-xs text-muted-foreground">
                · {r.subtitle}
              </span>
            </div>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase">
              {r.type}
            </span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
