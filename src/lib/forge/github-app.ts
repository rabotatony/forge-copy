// ============================================================
// Forge — GitHub App authentication (scaffold)
// ============================================================
// Provides JWT generation + installation token caching for GitHub App
// auth. This is the production-grade alternative to PAT auth.
//
// SETUP (user must do externally):
//   1. Register a GitHub App at https://github.com/settings/apps/new
//   2. Set the App's private key (PEM) as FORGE_GITHUB_APP_KEY env var
//   3. Set the App ID as FORGE_GITHUB_APP_ID env var
//   4. Install the App on your repos (repo → Settings → GitHub Apps)
//   5. Note the installation ID (shown in the URL after install)
//
// Once configured, this module replaces PAT auth automatically —
// getOctokit() will prefer App auth if the env vars are set.
// ============================================================

import * as crypto from "node:crypto";
import * as fs from "node:fs";

const APP_ID = process.env.FORGE_GITHUB_APP_ID;
// The PEM key can be set as an env var (multiline) OR as a file path.
const APP_KEY_ENV = process.env.FORGE_GITHUB_APP_KEY;
const APP_KEY_FILE = process.env.FORGE_GITHUB_APP_KEY_FILE;

let cachedKey: string | null = null;

function getAppPrivateKey(): string | null {
  if (cachedKey) return cachedKey;
  if (APP_KEY_ENV) {
    cachedKey = APP_KEY_ENV.replace(/\\n/g, "\n");
    return cachedKey;
  }
  if (APP_KEY_FILE && fs.existsSync(APP_KEY_FILE)) {
    cachedKey = fs.readFileSync(APP_KEY_FILE, "utf-8");
    return cachedKey;
  }
  return null;
}

export function isGitHubAppConfigured(): boolean {
  return !!APP_ID && !!getAppPrivateKey();
}

/**
 * Generate a GitHub App JWT (RS256). Valid for 10 minutes (GitHub
 * allows max 10 min). Used to authenticate as the App itself for
 * installation-token retrieval.
 */
export function generateAppJwt(): string {
  const key = getAppPrivateKey();
  if (!key) throw new Error("GitHub App private key not configured");
  if (!APP_ID) throw new Error("FORGE_GITHUB_APP_ID not set");

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // backdate 60s to account for clock skew
    exp: now + 9 * 60, // 9 min (max 10)
    iss: APP_ID,
  };

  // RS256 sign
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${body}`);
  const signature = sign.sign(key, "base64url");
  return `${header}.${body}.${signature}`;
}

// Cache installation tokens (they last 1 hour).
interface CachedToken {
  token: string;
  expiresAt: number;
}
const installationTokenCache = new Map<number, CachedToken>();

/**
 * Get an installation access token for a GitHub App installation.
 * Cached until 5 minutes before expiry.
 *
 * @param installationId The App installation ID (per repo/org).
 * @returns installation token string (use as Bearer auth).
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = installationTokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.token;
  }

  const jwt = generateAppJwt();
  const resp = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );

  if (!resp.ok) {
    throw new Error(`Failed to get installation token: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { token: string; expires_at: string };
  const token = data.token;
  const expiresAt = new Date(data.expires_at).getTime();

  installationTokenCache.set(installationId, { token, expiresAt });
  return token;
}

/**
 * Get the installation ID for a repo (owner/repo). Requires the App
 * to be installed on that repo.
 */
export async function getInstallationId(owner: string, repo: string): Promise<number | null> {
  const jwt = generateAppJwt();
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );

  if (!resp.ok) return null;
  const data = (await resp.json()) as { id: number };
  return data.id;
}
