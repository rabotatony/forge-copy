"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBytes } from "./format";

// ---------------------------------------------------------------------------
// Types — mirror the API contract returned by
// /api/forge/projects/[id]/files. Kept inline so this component is a
// drop-in replacement for the basic FileTree without coupling to other
// modules.
// ---------------------------------------------------------------------------

interface ApiFileNode {
  type: "dir" | "file";
  path: string;
  size: number;
  childrenCount?: number;
}

interface FileTreeResponse {
  tree: ApiFileNode[];
  totalFiles: number;
  truncated: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  children: TreeNode[];
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/**
 * Convert the flat DFS list returned by the files API into a nested tree.
 * Directories are sorted before files; both groups are alphabetical.
 */
function buildTree(nodes: ApiFileNode[]): TreeNode {
  const root: TreeNode = {
    name: "",
    path: "",
    type: "dir",
    size: 0,
    children: [],
  };
  const lookup = new Map<string, TreeNode>();
  lookup.set("", root);

  for (const n of nodes) {
    const segs = n.path.split("/").filter(Boolean);
    let parent = root;
    let curPath = "";
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      curPath = curPath ? `${curPath}/${seg}` : seg;
      const isLeaf = i === segs.length - 1;
      let existing = lookup.get(curPath);
      if (!existing) {
        existing = {
          name: seg,
          path: curPath,
          type: isLeaf ? n.type : "dir",
          size: isLeaf ? n.size : 0,
          children: [],
        };
        lookup.set(curPath, existing);
        parent.children.push(existing);
      }
      parent = existing;
    }
  }

  const sortRecursive = (n: TreeNode): void => {
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRecursive);
  };
  sortRecursive(root);
  return root;
}

/** Recursively collect every directory path under `node` (excluding root). */
function collectDirPaths(node: TreeNode, acc: Set<string>): void {
  if (node.type === "dir" && node.path) acc.add(node.path);
  for (const c of node.children) collectDirPaths(c, acc);
}

/**
 * Prune the tree to only branches that contain matches for the (lowercased)
 * search query. A file matches when its name contains the query. A directory
 * matches when its own name contains the query — in which case its full
 * subtree is preserved verbatim — or when any descendant matches.
 *
 * Returns null when nothing under `node` matches.
 */
function pruneForSearch(node: TreeNode, query: string): TreeNode | null {
  const ql = query.toLowerCase();
  const nameMatch = node.name.toLowerCase().includes(ql);

  if (node.type === "file") {
    return nameMatch ? node : null;
  }

  if (nameMatch) {
    // Directory name itself matches — keep its entire subtree so the user
    // can browse into the matched folder.
    return node;
  }

  const kept: TreeNode[] = [];
  for (const c of node.children) {
    const r = pruneForSearch(c, query);
    if (r) kept.push(r);
  }
  if (kept.length === 0) return null;
  return { ...node, children: kept };
}

/**
 * Render a file-type icon by filename extension. Implemented as a
 * module-scope render function (NOT a component) so it doesn't trip the
 * `react-hooks/static-components` lint rule that fires when a component
 * reference is assigned to a local const inside another component.
 */
function renderFileIcon(
  name: string,
  className?: string,
): React.ReactElement {
  const lower = name.toLowerCase();
  let Icon: LucideIcon = File;
  if (lower.endsWith(".json")) Icon = FileJson;
  else if (
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".log")
  )
    Icon = FileText;
  else if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".py") ||
    lower.endsWith(".go") ||
    lower.endsWith(".rs") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".rb") ||
    lower.endsWith(".java") ||
    lower.endsWith(".c") ||
    lower.endsWith(".cpp") ||
    lower.endsWith(".h")
  )
    Icon = FileCode;
  else if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".ico") ||
    lower.endsWith(".bmp")
  )
    Icon = FileImage;
  return <Icon className={className} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Tree row rendering
// ---------------------------------------------------------------------------

interface RowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function TreeRow({ node, depth, expanded, onToggle, onSelect }: RowProps) {
  const pad = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.type === "file") {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        style={pad}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {renderFileIcon(
          node.name,
          "size-4 shrink-0 text-muted-foreground",
        )}
        <span className="truncate font-mono text-xs">{node.name}</span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {formatBytes(node.size)}
        </span>
      </button>
    );
  }

  const isOpen = expanded.has(node.path);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        style={pad}
        aria-expanded={isOpen}
        className="flex h-9 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {hasChildren ? (
          isOpen ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )
        ) : (
          <span className="size-3.5 shrink-0" aria-hidden />
        )}
        {isOpen ? (
          <FolderOpen
            className="size-4 shrink-0 text-emerald-500/80"
            aria-hidden
          />
        ) : (
          <Folder
            className="size-4 shrink-0 text-emerald-500/80"
            aria-hidden
          />
        )}
        <span className="truncate font-mono text-xs">{node.name}</span>
        {hasChildren && (
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {node.children.length}
          </span>
        )}
      </button>
      {isOpen &&
        hasChildren &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileExplorer
// ---------------------------------------------------------------------------

/**
 * FileExplorer — an enhanced replacement for the basic FileTree.
 *
 * Features:
 *   • Search bar that filters files (and matching directories) by name,
 *     case-insensitive.
 *   • Tree view with expand/collapse per directory, plus "Expand all" and
 *     "Collapse all" controls.
 *   • File-type icons via lucide-react (Folder, FolderOpen, FileText,
 *     FileCode, FileJson, FileImage, File).
 *   • File size next to each file (formatted via formatBytes).
 *   • File count badge in the header.
 *   • Click on a file → calls `onSelect(path)`.
 *
 * Accent color for folder icons is emerald; no indigo or blue is used.
 */
export function FileExplorer({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [userInteracted, setUserInteracted] = useState(false);
  // Tracks the project we currently hold state for so we can reset cleanly
  // when it changes (React's "derived state during render" pattern — no
  // useEffect needed, which keeps react-hooks/set-state-in-effect happy).
  const [lastProjectId, setLastProjectId] = useState(projectId);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["forge", "projects", projectId, "files"],
    queryFn: async () => {
      const r = await fetch(`/api/forge/projects/${projectId}/files`);
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Failed to load files (${r.status})`,
        );
      }
      return (await r.json()) as FileTreeResponse;
    },
    staleTime: 60_000,
    retry: false,
  });

  // Reset expansion state when the project changes. Calling setState during
  // render (only when the prop actually changed) is the React-recommended
  // way to derive state from props without an effect.
  if (lastProjectId !== projectId) {
    setLastProjectId(projectId);
    setExpanded(new Set());
    setUserInteracted(false);
  }

  // Build the full nested tree once per data change.
  const fullTree = useMemo(
    () => (data ? buildTree(data.tree) : null),
    [data],
  );

  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery.length > 0;

  // Apply search pruning to the tree.
  const visibleTree = useMemo(() => {
    if (!fullTree) return null;
    if (!searchActive) return fullTree;
    return pruneForSearch(fullTree, trimmedQuery);
  }, [fullTree, searchActive, trimmedQuery]);

  // Default expansion set: top-level directories. Shown until the user
  // interacts with the tree so they have something useful to look at on
  // first load.
  const defaultExpanded = useMemo(() => {
    const acc = new Set<string>();
    if (!fullTree) return acc;
    for (const c of fullTree.children) {
      if (c.type === "dir") acc.add(c.path);
    }
    return acc;
  }, [fullTree]);

  // While a search is active, force every directory in the visible (already
  // pruned) tree to be expanded so all matches are visible. Before the user
  // interacts, fall back to the default expansion. Otherwise, use the
  // user-controlled expansion set.
  const effectiveExpanded = useMemo(() => {
    if (searchActive && visibleTree) {
      const acc = new Set<string>();
      collectDirPaths(visibleTree, acc);
      return acc;
    }
    if (!userInteracted) return defaultExpanded;
    return expanded;
  }, [expanded, searchActive, visibleTree, userInteracted, defaultExpanded]);

  const handleToggle = (path: string): void => {
    setUserInteracted(true);
    setExpanded((prev) => {
      // On the first interaction, snapshot the default expansion so the
      // user's first click doesn't blow away the auto-expanded depth-0 dirs.
      const base = !userInteracted ? defaultExpanded : prev;
      const next = new Set(base);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleExpandAll = (): void => {
    if (!fullTree) return;
    setUserInteracted(true);
    const acc = new Set<string>();
    collectDirPaths(fullTree, acc);
    setExpanded(acc);
  };

  const handleCollapseAll = (): void => {
    setUserInteracted(true);
    setExpanded(new Set());
  };

  // File count badge: prefer totalFiles from the API; fall back to 0.
  const fileCount = data?.totalFiles ?? 0;

  return (
    <Card>
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Folder className="size-4 text-emerald-500/80" />
            Files
            {fileCount > 0 && (
              <Badge
                variant="secondary"
                className="tabular-nums font-normal"
              >
                {fileCount} {fileCount === 1 ? "file" : "files"}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleExpandAll}
              disabled={!fullTree}
              className="h-7 px-2 text-xs"
            >
              Expand all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCollapseAll}
              disabled={!fullTree}
              className="h-7 px-2 text-xs"
            >
              Collapse all
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files by name…"
            className="pl-8"
            aria-label="Search files by name"
            type="search"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading files…
          </div>
        ) : isError ? (
          <p className="py-4 text-sm text-red-600 dark:text-red-400">
            {error instanceof Error
              ? error.message
              : "Failed to load files."}
          </p>
        ) : !visibleTree || visibleTree.children.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {searchActive
              ? `No files match "${trimmedQuery}".`
              : "No files found in this project."}
          </p>
        ) : (
          <>
            {data?.truncated && (
              <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
                Tree truncated — showing {data.tree.length} of{" "}
                {data.totalFiles}+ entries.
              </p>
            )}
            <div className="max-h-[400px] overflow-y-auto rounded-md border p-1">
              <div className="py-1">
                {visibleTree.children.map((child) => (
                  <TreeRow
                    key={child.path}
                    node={child}
                    depth={0}
                    expanded={effectiveExpanded}
                    onToggle={handleToggle}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
