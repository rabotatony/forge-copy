// ============================================================
// Forge — security: URL validation + shell-metachar detection
// ============================================================
// Single source of truth for the security checks that the
// clone-repo API route and git.ts both need. Replaces the
// duplicated FORBIDDEN_PATTERNS / validateGitUrl logic.
// ============================================================

/** Forbidden URL substrings — used to reject obviously abusive URLs. */
export const FORBIDDEN_URL_PATTERNS: readonly string[] = [
  "127.0.0.1",
  "localhost",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS / GCP metadata endpoint
  "metadata.google.internal",
  "fd00:", // private IPv6 ULA
  "fe80:", // link-local IPv6
  "fc00:", // private IPv6 ULA
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
];

/**
 * Reject URLs that point at private / loopback / link-local / metadata
 * addresses. This is defense-in-depth against SSRF: even if a user
 * supplies a URL that resolves to an internal address, we refuse to
 * clone it.
 */
export function isForbiddenUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return FORBIDDEN_URL_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Returns true if `value` contains characters that would let it
 * escape the current shell argument context. Used to guard against
 * command injection in URL/branch arguments that are passed to git.
 */
export function containsShellMetacharacters(value: string): boolean {
  return /[;&|`$<>{}\\\n\r!]/.test(value);
}
