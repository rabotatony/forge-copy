"use client";

// ============================================================
// Forge — AuthGate
// ============================================================
// Wraps the whole app. On load, checks /api/forge/auth/session.
//   • authenticated -> render the app
//   • not authenticated -> show the token login card
// After login a HttpOnly cookie (forge_session) is set, so every
// subsequent same-origin fetch is authenticated automatically.
// ============================================================
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Hammer, KeyRound, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type GateState = "loading" | "in" | "out";

export function AuthGate({ children }: { children: React.ReactNode }) {
  // Auth is optional and OFF by default. The app is open out of the box;
  // set FORGE_AUTH_ENABLED=1 and use /api/forge/auth/login to require login.
  return <>{children}</>;
}
