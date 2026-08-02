"use client";

import { useMemo, useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useProjectFiles,
  type FileNode,
} from "./use-forge-api";
import { renderFileIcon } from "./icon-map";
import { formatBytes } from "./format";

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  children: TreeNode[];
}

/**
 * Convert the flat list returned by /api/forge/projects/[id]/files (which is
 * in DFS order with each entry's full path) into a nested tree for rendering.
 */
function buildTree(nodes: FileNode[]): TreeNode {
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

  // Sort: directories first (alpha), then files (alpha)
  const sortRecursive = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRecursive);
  };
  sortRecursive(root);

  return root;
}

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const pad = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.type === "file") {
    const selected = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        style={pad}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          selected &&
            "bg-accent text-accent-foreground font-medium",
        )}
        aria-current={selected ? "true" : undefined}
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

  return (
    <DirectoryNode
      node={node}
      depth={depth}
      selectedPath={selectedPath}
      onSelect={onSelect}
      pad={pad}
    />
  );
}

function DirectoryNode({
  node,
  depth,
  selectedPath,
  onSelect,
  pad,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  pad: React.CSSProperties;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={pad}
        className="flex h-9 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
        {open ? (
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
      {open &&
        hasChildren &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function FileTree({
  projectId,
  selectedPath,
  onSelect,
}: {
  projectId: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const { data, isLoading, isError, error } = useProjectFiles(projectId);

  const tree = useMemo(
    () => (data ? buildTree(data.tree) : null),
    [data],
  );

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <p className="p-4 text-sm text-red-600 dark:text-red-400">
        Failed to load file tree: {error?.message}
      </p>
    );
  }
  if (!tree || tree.children.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No files found in this project.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {data?.truncated && (
        <p className="px-2 pb-1 text-[11px] text-amber-600 dark:text-amber-400">
          Tree truncated — showing {data.tree.length} of {data.totalFiles}+ entries.
        </p>
      )}
      <ScrollArea className="h-[480px] w-full rounded-md border p-1">
        <div className="py-1">
          {tree.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
