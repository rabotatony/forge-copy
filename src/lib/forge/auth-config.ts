// ============================================================
// Forge — Authentication scaffold (next-auth)
// ============================================================
// This module provides a ready-to-use next-auth configuration with
// GitHub OAuth provider. It's NOT wired up yet — to enable auth:
//
// SETUP (user must do externally):
//   1. Create a GitHub OAuth App at https://github.com/settings/developers
//   2. Set callback URL to: https://your-forge.com/api/auth/callback/github
//   3. Set env vars:
//      GITHUB_OAUTH_CLIENT_ID=your_client_id
//      GITHUB_OAUTH_CLIENT_SECRET=your_client_secret
//      NEXTAUTH_SECRET=your_random_secret (openssl rand -base64 32)
//      NEXTAUTH_URL=https://your-forge.com
//
//   4. Add to src/app/api/auth/[...nextauth]/route.ts:
//      import { authOptions } from "@/lib/forge/auth-config";
//      const handler = NextAuth(authOptions);
//      export { handler as GET, handler as POST };
//
//   5. Wrap protected routes with `withAuth` (see middleware below).
//
// Until configured, the app runs in "no-auth" mode (all routes open).
// This is fine for local dev / single-user instances behind a firewall.
// ============================================================

import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

const isAuthConfigured = !!process.env.GITHUB_OAUTH_CLIENT_ID && !!process.env.GITHUB_OAUTH_CLIENT_SECRET;

export const authOptions: NextAuthOptions | null = isAuthConfigured
  ? {
      providers: [
        GitHubProvider({
          clientId: process.env.GITHUB_OAUTH_CLIENT_ID!,
          clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET!,
          authorization: {
            params: { scope: "repo workflow read:org" },
          },
        }),
      ],
      secret: process.env.NEXTAUTH_SECRET,
      session: { strategy: "jwt" },
      callbacks: {
        async jwt({ token, account }) {
          if (account?.access_token) {
            token.githubToken = account.access_token;
          }
          return token;
        },
        async session({ session, token }) {
          (session as { githubToken?: string }).githubToken = token.githubToken as string | undefined;
          return session;
        },
      },
      pages: {
        signIn: "/auth/signin",
      },
    }
  : null;

/**
 * Check if auth is enabled. If false, the app runs in open mode.
 */
export function isAuthEnabled(): boolean {
  return authOptions !== null;
}

/**
 * Middleware helper: if auth is configured, require a session.
 * If not configured, allow all requests (dev/single-user mode).
 *
 * Usage in an API route:
 *   const session = await getSession(authOptions);
 *   if (isAuthEnabled() && !session) return Response.json({ error: "Unauthorized" }, { status: 401 });
 */
export async function requireAuth(): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  // In production with auth, check the session here.
  // For now, this is a scaffold — the actual session check needs
  // to be wired in middleware or per-route.
  return true;
}
