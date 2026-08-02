"use client";

import {
  Package,
  Hammer,
  FlaskConical,
  ScanLine,
  Search,
  GitFork,
  Box,
  Smartphone,
  Container,
  ShieldAlert,
  UploadCloud,
  Database,
  Ruler,
  FileCode,
  FileJson,
  FileText,
  File as FileIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Lookup table mapping the `icon` string returned by the Forge API
 * to the actual lucide-react component. Falls back to FileCode when
 * the icon name is unknown (keeps the UI resilient if the API adds
 * new icons before the UI ships an update).
 */
export const WORKFLOW_ICON_MAP: Record<string, LucideIcon> = {
  Package,
  Hammer,
  FlaskConical,
  ScanLine,
  Search,
  GitFork,
  Box,
  Smartphone,
  Container,
  ShieldAlert,
  UploadCloud,
  Database,
  Ruler,
};

/**
 * Render a workflow icon by name. Implemented as a module-scope render
 * function (NOT a component) so it doesn't trip the
 * `react-hooks/static-components` lint rule that fires when you assign
 * a component reference to a local const inside another component.
 */
export function renderWorkflowIcon(
  name: string | null | undefined,
  className?: string,
): React.ReactElement {
  const lookup: Record<string, LucideIcon> = WORKFLOW_ICON_MAP;
  const Icon = (name && lookup[name]) || FileCode;
  return <Icon className={className} aria-hidden />;
}

/**
 * Pick a file-type icon based on filename extension. Same render-function
 * pattern as renderWorkflowIcon.
 */
export function renderFileIcon(
  name: string,
  className?: string,
): React.ReactElement {
  const lower = name.toLowerCase();
  let Icon: LucideIcon = FileIcon;
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
    lower.endsWith(".py") ||
    lower.endsWith(".go") ||
    lower.endsWith(".rs")
  )
    Icon = FileCode;
  return <Icon className={className} aria-hidden />;
}
