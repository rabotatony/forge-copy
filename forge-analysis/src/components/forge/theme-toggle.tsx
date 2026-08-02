"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * ThemeToggle — a compact dropdown for switching between light, dark,
 * and system themes. Uses next-themes (class-based, no flash).
 *
 * The trigger icon is determined by the `resolvedTheme`. On the server
 * (and first client paint) `resolvedTheme` is undefined, so we render
 * a neutral Sun icon to avoid hydration mismatch. After hydration the
 * correct icon appears.
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const isDark = resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Toggle theme"
        >
          {isDark ? (
            <Moon className="size-4" />
          ) : (
            <Sun className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="size-4" />
          <span>Light</span>
          {theme === "light" && <span className="ml-auto text-emerald-600">●</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="size-4" />
          <span>Dark</span>
          {theme === "dark" && <span className="ml-auto text-emerald-600">●</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="size-4" />
          <span>System</span>
          {theme === "system" && <span className="ml-auto text-emerald-600">●</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
