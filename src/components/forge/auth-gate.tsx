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

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/forge/auth/session")
      .then(async (r) => {
        if (!alive) return;
        if (r.ok) {
          const d = await r.json().catch(() => null);
          if (d?.token?.name) setWho(d.token.name);
          setState("in");
        } else {
          setState("out");
        }
      })
      .catch(() => {
        if (alive) setState("out");
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async () => {
    const t = token.trim();
    if (!t) {
      setError("Enter your API token (fk_...)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/forge/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t }),
      });
      if (r.ok) {
        const d = await r.json().catch(() => null);
        if (d?.token?.name) setWho(d.token.name);
        setState("in");
      } else {
        const d = await r.json().catch(() => null);
        setError(d?.error ?? `Login failed (${r.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [token]);

  if (state === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === "in") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-emerald-500/10">
            <Hammer className="size-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Forge</h1>
          <p className="text-xs text-muted-foreground">
            Sovereign CI — enter an admin API token to continue
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
          className="space-y-3"
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="forge-api-token"
              name="forge-api-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="fk_..."
              className="pl-9 font-mono text-sm"
              autoFocus
              autoComplete="off"
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            {busy ? "Checking..." : "Connect"}
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          Tokens: Settings &rarr; API Tokens (admin scope), or create one via
          <span className="font-mono"> POST /api/forge/tokens</span>
        </p>
      </div>
    </div>
  );
}
